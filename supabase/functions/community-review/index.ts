import { cleanText, handleOptions, json, parseJson, PublicError, publicErrorResponse } from '../_shared/core.ts';
import { enqueueEmail } from '../_shared/email.ts';
import {
  adminClient,
  notifyAdmins,
  removeImages,
  splitName,
  uploadImage,
  validateImage,
  verifyInvite,
} from '../_shared/community.ts';

async function inviteContext(token: unknown, code: unknown) {
  const verified = await verifyInvite(token, code);
  const admin = adminClient();
  const { invite } = verified;

  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id,customer_id,external_order_number,order_date,status,payment_status')
    .eq('id', invite.order_id)
    .eq('customer_id', invite.customer_id)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order || order.payment_status !== 'pago' || ['cancelado', 'reembolsado'].includes(order.status)) {
    throw new PublicError('Este pedido não está disponível para avaliação.', 409);
  }

  const [itemsResult, reviewsResult, customerResult] = await Promise.all([
    admin.from('order_items').select('id,product_id,product_name,quantity').eq('order_id', order.id).order('created_at'),
    admin.from('product_reviews').select('order_item_id').eq('order_id', order.id),
    admin.from('customers').select('id,full_name,email').eq('id', order.customer_id).maybeSingle(),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (reviewsResult.error) throw reviewsResult.error;
  if (customerResult.error) throw customerResult.error;

  const reviewed = new Set((reviewsResult.data || []).map((row) => row.order_item_id));
  const availableItems = (itemsResult.data || []).filter((item) => item.product_id && !reviewed.has(item.id));
  if (!availableItems.length) throw new PublicError('Os produtos deste pedido já foram avaliados.', 409);

  const productIds = Array.from(new Set(availableItems.map((item) => item.product_id)));
  const productsResult = await admin
    .from('products')
    .select('id,name,store_key,store_images')
    .in('id', productIds);
  if (productsResult.error) throw productsResult.error;
  const products = new Map((productsResult.data || []).map((product) => [product.id, product]));

  return {
    ...verified,
    order,
    customer: customerResult.data,
    items: availableItems.map((item) => {
      const product = products.get(item.product_id);
      const images = Array.isArray(product?.store_images) ? product.store_images : [];
      return {
        order_item_id: item.id,
        product_id: item.product_id,
        name: product?.name || item.product_name,
        store_key: product?.store_key || null,
        image: typeof images[0] === 'string' ? images[0] : null,
        quantity: item.quantity,
      };
    }),
  };
}

function parseReviews(value: FormDataEntryValue | null) {
  let reviews: any[];
  try { reviews = JSON.parse(String(value || '[]')); } catch { throw new PublicError('Avaliações inválidas.'); }
  if (!Array.isArray(reviews) || reviews.length < 1 || reviews.length > 20) {
    throw new PublicError('Avalie pelo menos um produto.');
  }
  return reviews;
}

async function submitReviews(req: Request) {
  const form = await req.formData();
  const context = await inviteContext(form.get('token'), form.get('code'));
  const { firstName, lastName } = splitName(form.get('first_name'), form.get('last_name'));
  if (!lastName) throw new PublicError('Informe seu sobrenome.');

  const rawReviews = parseReviews(form.get('reviews'));
  const allowed = new Map(context.items.map((item) => [item.order_item_id, item]));
  const seen = new Set<string>();
  const prepared = rawReviews.map((review) => {
    const orderItemId = cleanText(review?.order_item_id, 80);
    const item = allowed.get(orderItemId);
    if (!item || seen.has(orderItemId)) throw new PublicError('Um dos produtos informados não pertence ao pedido.');
    seen.add(orderItemId);
    const rating = Number(review?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new PublicError(`Escolha de 1 a 5 estrelas para ${item.name}.`);
    const title = cleanText(review?.title, 120);
    const comment = cleanText(review?.comment, 2000);
    if (comment.length < 3) throw new PublicError(`Conte um pouco sobre sua experiência com ${item.name}.`);
    const fileValue = form.get(`photo_${orderItemId}`);
    const file = fileValue instanceof File ? validateImage(fileValue) : null;
    return { id: crypto.randomUUID(), item, rating, title: title || null, comment, file, mediaPath: null as string | null };
  });

  const uploaded: string[] = [];
  try {
    for (const review of prepared) {
      if (review.file) {
        review.mediaPath = await uploadImage(review.file, `reviews/${review.id}`);
        uploaded.push(review.mediaPath);
      }
    }

    const rows = prepared.map((review) => ({
      id: review.id,
      invite_id: context.invite.id,
      order_id: context.order.id,
      order_item_id: review.item.order_item_id,
      product_id: review.item.product_id,
      customer_id: context.order.customer_id,
      reviewer_first_name: firstName,
      reviewer_last_name: lastName,
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      media_path: review.mediaPath,
      verified_purchase: true,
      status: 'pending',
    }));
    const inserted = await adminClient().from('product_reviews').insert(rows);
    if (inserted.error) throw inserted.error;
  } catch (error) {
    await removeImages(uploaded);
    console.error('Review submission failed', error);
    if (error instanceof PublicError) throw error;
    throw new PublicError('Não foi possível salvar sua avaliação. Tente novamente.', 500);
  }

  const now = new Date().toISOString();
  const used = await adminClient().from('review_invites').update({ status: 'used', used_at: now }).eq('id', context.invite.id).eq('status', 'pending');
  if (used.error) console.error('Invite completion failed', used.error);

  const customerEmail = String(context.customer?.email || '').trim().toLowerCase();
  if (customerEmail) {
    try {
      await enqueueEmail({
        category: 'transactional',
        templateKey: 'review_received',
        recipientEmail: customerEmail,
        recipientName: context.customer?.full_name || `${firstName} ${lastName}`,
        senderKind: 'customer',
        subject: 'Recebemos sua avaliação do Café Itajaó',
        payload: { customer_name: context.customer?.full_name || firstName },
        idempotencyKey: `review-invite:${context.invite.id}:received`,
        relatedOrderId: context.order.id,
        relatedCustomerId: context.order.customer_id,
        resourceType: 'review_invite',
        resourceId: context.invite.id,
        priority: 45,
      });
    } catch (error) {
      console.error('Review receipt email queue failed', error);
    }
  }

  try {
    await notifyAdmins({
      kind: 'review_received',
      title: prepared.length === 1 ? 'Nova avaliação recebida' : `${prepared.length} novas avaliações recebidas`,
      message: `${firstName} ${lastName} enviou avaliação do pedido ${context.order.external_order_number || context.order.id.slice(0, 8)}.`,
      eventKey: `review-submission:${context.invite.id}`,
      metadata: { invite_id: context.invite.id, order_id: context.order.id, review_ids: prepared.map((review) => review.id) },
      templateKey: 'admin_review_received',
      resourceType: 'review',
      resourceId: prepared[0].id,
    });
  } catch (error) {
    console.error('Review admin notification failed', error);
  }

  return json({ ok: true, submitted: prepared.length });
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) return await submitReviews(req);

    const body = await parseJson(req);
    if (body?.action !== 'verify') throw new PublicError('Ação inválida.');
    const context = await inviteContext(body?.token, body?.code);
    return json({
      ok: true,
      order_number: context.order.external_order_number,
      customer_first_name: String(context.customer?.full_name || '').split(/\s+/)[0],
      expires_at: context.invite.expires_at,
      products: context.items,
    });
  } catch (error) {
    return publicErrorResponse(error);
  }
});
