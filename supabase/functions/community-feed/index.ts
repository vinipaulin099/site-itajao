import { cleanText, handleOptions, json, PublicError, publicErrorResponse } from '../_shared/core.ts';
import { adminClient, signedImageUrl } from '../_shared/community.ts';

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function publicReviewer(first: unknown, last: unknown) {
  const firstName = cleanText(first, 80);
  const lastName = cleanText(last, 100);
  return lastName ? `${firstName} ${lastName.charAt(0).toUpperCase()}.` : firstName;
}

function requestedProductSkus(url: URL) {
  return Array.from(new Set(
    String(url.searchParams.get('skus') || '')
      .split(',')
      .map((value) => cleanText(value, 64).toUpperCase())
      .filter((value) => /^[A-Z0-9-]+$/.test(value)),
  )).slice(0, 24);
}

async function reviewSummaries(url: URL) {
  const skus = requestedProductSkus(url);
  if (!skus.length) return { items: [] };

  const admin = adminClient();
  const productsResult = await admin
    .from('products')
    .select('id,sku')
    .in('sku', skus)
    .eq('active', true);
  if (productsResult.error) throw productsResult.error;

  const products = productsResult.data || [];
  const productIds = products.map((product) => product.id);
  const ratingsResult = productIds.length
    ? await admin
      .from('product_reviews')
      .select('product_id,rating')
      .in('product_id', productIds)
      .eq('status', 'approved')
      .limit(5000)
    : { data: [], error: null };
  if (ratingsResult.error) throw ratingsResult.error;

  const productBySku = new Map(products.map((product) => [product.sku, product.id]));
  const ratingsByProduct = new Map<string, number[]>();
  for (const review of ratingsResult.data || []) {
    const values = ratingsByProduct.get(review.product_id) || [];
    values.push(Number(review.rating));
    ratingsByProduct.set(review.product_id, values);
  }

  const items = skus.map((sku) => {
    const productId = productBySku.get(sku);
    const values = productId ? ratingsByProduct.get(productId) || [] : [];
    const average = values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
      : 0;
    return { sku, average, total: values.length };
  });
  return { items };
}

async function reviewFeed(url: URL) {
  const admin = adminClient();
  const page = positiveInt(url.searchParams.get('page'), 1, 10000);
  const limit = positiveInt(url.searchParams.get('limit'), 12, 24);
  const rating = Number(url.searchParams.get('rating') || 0);
  const productKey = cleanText(url.searchParams.get('product'), 80);
  let productId = '';

  if (productKey) {
    const { data: product, error } = await admin
      .from('products')
      .select('id')
      .eq('store_key', productKey)
      .eq('store_visible', true)
      .maybeSingle();
    if (error) throw error;
    if (!product) return { items: [], total: 0, page, limit, average: 0, distribution: {} };
    productId = product.id;
  }

  let query = admin
    .from('product_reviews')
    .select('id,product_id,rating,title,comment,media_path,reviewer_first_name,reviewer_last_name,admin_response,admin_responded_at,published_at', { count: 'exact' })
    .eq('status', 'approved')
    .order('published_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (productId) query = query.eq('product_id', productId);
  if (Number.isInteger(rating) && rating >= 1 && rating <= 5) query = query.eq('rating', rating);
  const { data, count, error } = await query;
  if (error) throw error;

  const productIds = Array.from(new Set((data || []).map((row) => row.product_id)));
  const productMap = new Map<string, { name: string; store_key: string }>();
  if (productIds.length) {
    const products = await admin.from('products').select('id,name,store_key').in('id', productIds);
    if (products.error) throw products.error;
    for (const product of products.data || []) productMap.set(product.id, product);
  }

  let ratingsQuery = admin.from('product_reviews').select('rating').eq('status', 'approved').limit(5000);
  if (productId) ratingsQuery = ratingsQuery.eq('product_id', productId);
  const ratings = await ratingsQuery;
  if (ratings.error) throw ratings.error;
  const values = (ratings.data || []).map((row) => Number(row.rating));
  const distribution = values.reduce<Record<string, number>>((acc, value) => {
    acc[String(value)] = (acc[String(value)] || 0) + 1;
    return acc;
  }, {});
  const average = values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;

  const items = await Promise.all((data || []).map(async (row) => ({
    id: row.id,
    product: productMap.get(row.product_id) || null,
    rating: row.rating,
    title: row.title,
    comment: row.comment,
    reviewer: publicReviewer(row.reviewer_first_name, row.reviewer_last_name),
    verified_purchase: true,
    image_url: await signedImageUrl(row.media_path),
    admin_response: row.admin_response,
    admin_responded_at: row.admin_responded_at,
    published_at: row.published_at,
  })));
  return { items, total: count || 0, page, limit, average, distribution };
}

async function recipeFeed(url: URL) {
  const admin = adminClient();
  const page = positiveInt(url.searchParams.get('page'), 1, 10000);
  const limit = positiveInt(url.searchParams.get('limit'), 9, 18);
  const { data, count, error } = await admin
    .from('recipe_submissions')
    .select('id,author_name,title,introduction,ingredients,instructions,prep_minutes,servings,image_path,admin_response,published_at', { count: 'exact' })
    .eq('status', 'approved')
    .order('published_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw error;

  const items = await Promise.all((data || []).map(async (row) => ({
    id: row.id,
    author_name: row.author_name,
    title: row.title,
    introduction: row.introduction,
    ingredients: row.ingredients,
    instructions: row.instructions,
    prep_minutes: row.prep_minutes,
    servings: row.servings,
    image_url: await signedImageUrl(row.image_path),
    admin_response: row.admin_response,
    published_at: row.published_at,
  })));
  return { items, total: count || 0, page, limit };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'GET') return json({ error: 'Método não permitido.' }, 405);
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'reviews';
    if (type === 'reviews') return json(await reviewFeed(url));
    if (type === 'review_summaries') return json(await reviewSummaries(url));
    if (type === 'recipes') return json(await recipeFeed(url));
    throw new PublicError('Tipo de conteúdo inválido.');
  } catch (error) {
    return publicErrorResponse(error);
  }
});
