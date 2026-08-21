import { cleanText, handleOptions, json, parseJson, PublicError, publicErrorResponse } from '../_shared/core.ts';
import { enqueueEmail } from '../_shared/email.ts';
import {
  adminClient,
  requireAdmin,
  signedImageUrl,
} from '../_shared/community.ts';

function siteUrl(path = '') {
  const configured = String(Deno.env.get('SITE_URL') || 'https://www.cafeitajao.com.br').trim();
  let base = 'https://www.cafeitajao.com.br';
  try {
    const parsed = new URL(configured);
    if (parsed.hostname.toLowerCase() === 'cafeitajao.com.br') {
      parsed.hostname = 'www.cafeitajao.com.br';
    }
    base = parsed.toString().replace(/\/+$/, '');
  } catch {
    // Mantém o domínio público canônico se a variável estiver inválida.
  }
  return path ? `${base}/${path.replace(/^\/+/, '')}` : base;
}

function whatsappNumber(value: unknown) {
  let number = String(value ?? '').replace(/\D/g, '');
  if (number.length === 10 || number.length === 11) number = `55${number}`;
  return /^55\d{10,11}$/.test(number) ? number : '';
}

async function orderInviteContext(orderId: string) {
  const admin = adminClient();
  const { data: order, error } = await admin
    .from('orders')
    .select('id,customer_id,external_order_number,order_date,status,payment_status')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) throw new PublicError('Pedido não encontrado.', 404);
  if (order.payment_status !== 'pago' || ['cancelado', 'reembolsado'].includes(order.status)) {
    throw new PublicError('Somente pedidos pagos e válidos podem receber convite.', 409);
  }

  const [customerResult, itemsResult, reviewedResult] = await Promise.all([
    admin.from('customers').select('id,full_name,email,phone').eq('id', order.customer_id).maybeSingle(),
    admin.from('order_items').select('id,product_id,product_name').eq('order_id', order.id),
    admin.from('product_reviews').select('order_item_id').eq('order_id', order.id),
  ]);
  if (customerResult.error) throw customerResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (reviewedResult.error) throw reviewedResult.error;
  if (!customerResult.data) throw new PublicError('Cliente do pedido não encontrado.', 404);
  const reviewed = new Set((reviewedResult.data || []).map((row) => row.order_item_id));
  const available = (itemsResult.data || []).filter((item) => item.product_id && !reviewed.has(item.id));
  if (!available.length) throw new PublicError('Todos os produtos deste pedido já foram avaliados.', 409);
  return { order, customer: customerResult.data, items: available };
}

async function getReviewInvite(body: Record<string, unknown>, userId: string) {
  const orderId = cleanText(body.order_id, 80);
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new PublicError('Pedido inválido.');
  const context = await orderInviteContext(orderId);
  const admin = adminClient();
  const ensured = await admin.rpc('ensure_review_invite', {
    p_order_id: orderId,
    p_created_by: userId,
  });
  if (ensured.error) throw ensured.error;

  const { data: invite, error } = await admin
    .from('review_invites')
    .select('id,expires_at,link_token,access_code')
    .eq('id', ensured.data)
    .maybeSingle();
  if (error) throw error;
  if (!invite?.link_token || !invite?.access_code) {
    throw new PublicError('Não foi possível recuperar o acesso desta venda.', 500);
  }

  const token = String(invite.link_token);
  const code = String(invite.access_code);

  const reviewUrl = new URL(siteUrl('avaliar.html'));
  reviewUrl.searchParams.set('token', token);
  const firstName = String(context.customer.full_name || 'Olá').split(/\s+/)[0];
  const message = `Olá, ${firstName}! ☕ Seu Café Itajaó já rendeu boas xícaras? Sua experiência pode ajudar outras pessoas a escolherem um café especial e também nos ajuda a melhorar sempre.\n\nConte para a gente por aqui: ${reviewUrl.toString()}\n\nO acesso é individual, já reconhece o seu pedido e fica válido por 30 dias.`;
  const phone = whatsappNumber(context.customer.phone);

  if (body.send_email === true && context.customer.email) {
    await enqueueEmail({
      category: 'transactional',
      templateKey: 'review_invite',
      recipientEmail: String(context.customer.email).toLowerCase(),
      recipientName: context.customer.full_name,
      senderKind: 'customer',
      subject: 'Como foi sua experiência com o Café Itajaó?',
      payload: {
        customer_name: context.customer.full_name,
        order_number: context.order.external_order_number,
        review_url: reviewUrl.toString(),
        code,
      },
      idempotencyKey: `review-invite:${invite.id}:email`,
      relatedOrderId: orderId,
      relatedCustomerId: context.order.customer_id,
      resourceType: 'review_invite',
      resourceId: invite.id,
      priority: 60,
    });
  }

  return {
    ok: true,
    invite_id: invite.id,
    expires_at: invite.expires_at,
    review_url: reviewUrl.toString(),
    code,
    whatsapp_message: message,
    whatsapp_url: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null,
    email_queued: body.send_email === true && Boolean(context.customer.email),
    products: context.items.map((item) => item.product_name),
  };
}

async function pendingContent() {
  const admin = adminClient();
  const [reviewResult, recipeResult] = await Promise.all([
    admin.from('product_reviews')
      .select('id,product_id,customer_id,order_id,rating,title,comment,media_path,reviewer_first_name,reviewer_last_name,created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(100),
    admin.from('recipe_submissions')
      .select('id,author_name,email,title,introduction,ingredients,instructions,prep_minutes,servings,image_path,created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(100),
  ]);
  if (reviewResult.error) throw reviewResult.error;
  if (recipeResult.error) throw recipeResult.error;

  const productIds = Array.from(new Set((reviewResult.data || []).map((row) => row.product_id)));
  const products = productIds.length
    ? await admin.from('products').select('id,name,store_key').in('id', productIds)
    : { data: [], error: null };
  if (products.error) throw products.error;
  const productMap = new Map((products.data || []).map((product) => [product.id, product]));

  const reviews = await Promise.all((reviewResult.data || []).map(async (row) => ({
    ...row,
    media_path: undefined,
    image_url: await signedImageUrl(row.media_path, 900),
    product: productMap.get(row.product_id) || null,
  })));
  const recipes = await Promise.all((recipeResult.data || []).map(async (row) => ({
    ...row,
    image_path: undefined,
    image_url: await signedImageUrl(row.image_path, 900),
  })));
  return { reviews, recipes };
}

async function eligibleOrders() {
  const admin = adminClient();
  const { data: orders, error } = await admin
    .from('orders')
    .select('id,customer_id,external_order_number,order_date,status,payment_status')
    .eq('payment_status', 'pago')
    .not('status', 'in', '(cancelado,reembolsado)')
    .order('order_date', { ascending: false })
    .limit(100);
  if (error) throw error;
  if (!orders?.length) return [];

  const orderIds = orders.map((order) => order.id);
  const customerIds = Array.from(new Set(orders.map((order) => order.customer_id)));
  const [customers, items, reviews, invites] = await Promise.all([
    admin.from('customers').select('id,full_name,email,phone').in('id', customerIds),
    admin.from('order_items').select('id,order_id,product_id').in('order_id', orderIds),
    admin.from('product_reviews').select('order_item_id').in('order_id', orderIds),
    admin.from('review_invites').select('id,order_id,status,expires_at,created_at,access_code').in('order_id', orderIds).order('created_at', { ascending: false }),
  ]);
  for (const result of [customers, items, reviews, invites]) if (result.error) throw result.error;
  const customerMap = new Map((customers.data || []).map((customer) => [customer.id, customer]));
  const reviewed = new Set((reviews.data || []).map((review) => review.order_item_id));
  const latestInvite = new Map<string, any>();
  for (const invite of invites.data || []) if (!latestInvite.has(invite.order_id)) latestInvite.set(invite.order_id, invite);

  return orders.map((order) => {
    const reviewable = (items.data || []).filter((item) => item.order_id === order.id && item.product_id && !reviewed.has(item.id));
    return {
      ...order,
      customer: customerMap.get(order.customer_id) || null,
      reviewable_items: reviewable.length,
      latest_invite: latestInvite.get(order.id) || null,
    };
  }).filter((order) => order.reviewable_items > 0);
}

async function moderateReview(body: Record<string, unknown>, userId: string) {
  const id = cleanText(body.id, 80);
  const status = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : '';
  if (!id || !status) throw new PublicError('Avaliação ou decisão inválida.');
  const admin = adminClient();
  const { data: review, error } = await admin.from('product_reviews').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!review) throw new PublicError('Avaliação não encontrada.', 404);

  const now = new Date().toISOString();
  const response = cleanText(body.admin_response, 1500) || null;
  const updated = await admin.from('product_reviews').update({
    status,
    admin_response: response,
    admin_responded_at: response ? now : null,
    moderation_notes: cleanText(body.moderation_notes, 2000) || null,
    moderated_by: userId,
    moderated_at: now,
    published_at: status === 'approved' ? now : null,
  }).eq('id', id);
  if (updated.error) throw updated.error;

  if (status === 'approved') {
    const [customer, product] = await Promise.all([
      admin.from('customers').select('full_name,email').eq('id', review.customer_id).maybeSingle(),
      admin.from('products').select('name,store_key').eq('id', review.product_id).maybeSingle(),
    ]);
    if (customer.error) throw customer.error;
    if (product.error) throw product.error;
    if (customer.data?.email) {
      const productUrl = product.data?.store_key
        ? siteUrl(`produto.html?id=${encodeURIComponent(product.data.store_key)}#avaliacoes`)
        : siteUrl('comunidade.html');
      await enqueueEmail({
        category: 'transactional',
        templateKey: 'review_published',
        recipientEmail: String(customer.data.email).toLowerCase(),
        recipientName: customer.data.full_name,
        senderKind: 'customer',
        subject: 'Sua avaliação foi publicada na Comunidade Itajaó',
        payload: {
          customer_name: customer.data.full_name,
          product_name: product.data?.name || 'Café Itajaó',
          community_url: productUrl,
        },
        idempotencyKey: `review:${id}:published`,
        relatedOrderId: review.order_id,
        relatedCustomerId: review.customer_id,
        resourceType: 'review',
        resourceId: id,
        priority: 65,
      });
    }
  }
  return { ok: true };
}

async function moderateRecipe(body: Record<string, unknown>, userId: string) {
  const id = cleanText(body.id, 80);
  const status = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : '';
  if (!id || !status) throw new PublicError('Receita ou decisão inválida.');
  const admin = adminClient();
  const { data: recipe, error } = await admin.from('recipe_submissions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!recipe) throw new PublicError('Receita não encontrada.', 404);

  const now = new Date().toISOString();
  const response = cleanText(body.admin_response, 1500) || null;
  const updated = await admin.from('recipe_submissions').update({
    status,
    admin_response: response,
    moderation_notes: cleanText(body.moderation_notes, 2000) || null,
    moderated_by: userId,
    moderated_at: now,
    published_at: status === 'approved' ? now : null,
  }).eq('id', id);
  if (updated.error) throw updated.error;

  if (status === 'approved') {
    await enqueueEmail({
      category: 'transactional',
      templateKey: 'recipe_published',
      recipientEmail: recipe.email,
      recipientName: recipe.author_name,
      senderKind: 'customer',
      subject: 'Sua receita foi publicada na Comunidade Itajaó',
      payload: {
        customer_name: recipe.author_name,
        recipe_title: recipe.title,
        community_url: siteUrl('comunidade.html#receitas'),
      },
      idempotencyKey: `recipe:${id}:published`,
      relatedCustomerId: recipe.customer_id,
      resourceType: 'recipe',
      resourceId: id,
      priority: 65,
    });
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    const adminUser = await requireAdmin(req);
    const body = await parseJson(req);
    switch (body?.action) {
      case 'pending': return json(await pendingContent());
      case 'eligible_orders': return json({ items: await eligibleOrders() });
      case 'get_review_invite':
      case 'create_review_invite': return json(await getReviewInvite(body, adminUser.userId));
      case 'moderate_review': return json(await moderateReview(body, adminUser.userId));
      case 'moderate_recipe': return json(await moderateRecipe(body, adminUser.userId));
      default: throw new PublicError('Ação administrativa inválida.');
    }
  } catch (error) {
    return publicErrorResponse(error);
  }
});
