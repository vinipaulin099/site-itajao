import { catalogIdFromSku } from './catalog.ts';
import { env, PublicError } from './core.ts';

function adminApiKey() {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')?.trim() || '';
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      const key = String(parsed?.default || '').trim();
      if (key) return { key, legacyJwt: false };
    } catch (error) {
      console.error('SUPABASE_SECRET_KEYS inválido', error);
    }
  }
  return { key: env('SUPABASE_SERVICE_ROLE_KEY'), legacyJwt: true };
}

function dbHeaders(extra: HeadersInit = {}) {
  const auth = adminApiKey();
  return {
    apikey: auth.key,
    ...(auth.legacyJwt ? { Authorization: `Bearer ${auth.key}` } : {}),
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function dbRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: dbHeaders(init.headers),
  });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    console.error('Supabase REST error', response.status, data);
    throw new PublicError('Falha interna ao registrar o pedido.', 500);
  }
  return data;
}

export async function insertOrder(payload: {
  customer: Record<string, unknown>;
  address: Record<string, unknown>;
  items: Record<string, unknown>[];
  subtotal: number;
  shippingAmount: number;
  shippingCost: number;
  shippingServiceId: number;
  shippingServiceName: string;
  shippingCarrier: string;
  shippingQuote: unknown;
}) {
  const order = await dbRequest('rpc/create_site_checkout_order', {
    method: 'POST',
    body: JSON.stringify({
      p_customer: payload.customer,
      p_address: payload.address,
      p_items: payload.items,
      p_subtotal: payload.subtotal,
      p_shipping_amount: payload.shippingAmount,
      p_shipping_cost: payload.shippingCost,
      p_shipping_service_id: payload.shippingServiceId,
      p_shipping_service_name: payload.shippingServiceName,
      p_shipping_carrier: payload.shippingCarrier || null,
      p_shipping_quote: payload.shippingQuote ?? null,
    }),
  });
  return order;
}

async function productSkus(items: any[]) {
  const ids = Array.from(new Set(items.map((item) => String(item.product_id || '')).filter(Boolean)));
  if (!ids.length) return new Map<string, string>();
  const rows = await dbRequest(`products?id=in.(${ids.join(',')})&select=id,sku`);
  return new Map<string, string>((rows || []).map((row: any) => [String(row.id), String(row.sku || '')]));
}

function customerFromRow(row: any) {
  if (!row) return null;
  const document = String(row.cpf_cnpj || '').replace(/\D/g, '');
  return {
    name: row.full_name,
    email: row.email,
    phone: String(row.phone || '').replace(/\D/g, ''),
    document,
    personType: document.length === 14 ? 'J' : 'F',
  };
}

function addressFromRow(row: any) {
  if (!row) return null;
  return {
    postalCode: String(row.postal_code || '').replace(/\D/g, ''),
    street: row.address_line,
    number: row.address_number,
    complement: row.address_complement || '',
    district: row.neighborhood,
    city: row.city,
    state: String(row.state || '').trim().toUpperCase(),
  };
}

export async function getOrder(id: string) {
  const [orders, integrations] = await Promise.all([
    dbRequest(`orders?id=eq.${encodeURIComponent(id)}&select=*`),
    dbRequest(`site_order_integrations?order_id=eq.${encodeURIComponent(id)}&select=*`),
  ]);
  const order = orders?.[0];
  const integration = integrations?.[0];
  if (!order || !integration) return null;

  const [customers, items] = await Promise.all([
    dbRequest(`customers?id=eq.${encodeURIComponent(order.customer_id)}&select=*`),
    dbRequest(`order_items?order_id=eq.${encodeURIComponent(id)}&select=*`),
  ]);
  const customerRow = customers?.[0] || null;
  const skuByProductId = await productSkus(items || []);

  return {
    ...order,
    ...integration,
    id: order.id,
    order_number: order.external_order_number,
    status: integration.checkout_status,
    total: Number(order.total_amount || 0),
    shipping_amount: Number(order.shipping_amount || 0),
    tracking_code: order.tracking_code || null,
    customer: integration.customer_snapshot && Object.keys(integration.customer_snapshot).length
      ? integration.customer_snapshot
      : customerFromRow(customerRow),
    delivery_address: integration.delivery_address && Object.keys(integration.delivery_address).length
      ? integration.delivery_address
      : addressFromRow(customerRow),
    items: (items || []).map((item: any) => {
      const sku = skuByProductId.get(String(item.product_id || '')) || '';
      return {
        id: catalogIdFromSku(sku),
        sku,
        productId: item.product_id || null,
        name: item.product_name,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price),
      };
    }),
  };
}

export async function getPublicOrder(id: string, token: string) {
  const integrations = await dbRequest(`site_order_integrations?order_id=eq.${encodeURIComponent(id)}&public_token=eq.${encodeURIComponent(token)}&select=order_id,checkout_status,mp_payment_status`);
  const integration = integrations?.[0];
  if (!integration) return null;
  const orders = await dbRequest(`orders?id=eq.${encodeURIComponent(id)}&select=id,external_order_number,total_amount,tracking_code,created_at`);
  const order = orders?.[0];
  if (!order) return null;
  return {
    id: order.id,
    order_number: order.external_order_number,
    status: integration.checkout_status,
    total: Number(order.total_amount || 0),
    mp_payment_status: integration.mp_payment_status,
    tracking_code: order.tracking_code || null,
    created_at: order.created_at,
  };
}

// Metadados técnicos do checkout/integrações. O pedido comercial permanece em public.orders.
export async function updateOrder(id: string, payload: Record<string, unknown>) {
  const rows = await dbRequest(`site_order_integrations?order_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  return rows?.[0] ? await getOrder(id) : null;
}

export async function updateCrmOrder(id: string, payload: Record<string, unknown>) {
  const rows = await dbRequest(`orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
  });
  return rows?.[0] ?? null;
}

export async function recordPayment(orderId: string, payment: {
  amount: number;
  method: string;
  status: 'pendente' | 'pago' | 'cancelado' | 'reembolsado';
  paidAt: string | null;
  externalReference: string;
  notes: string;
}) {
  await updateCrmOrder(orderId, { payment_status: payment.status });
  const existing = await dbRequest(`payments?order_id=eq.${encodeURIComponent(orderId)}&external_reference=eq.${encodeURIComponent(payment.externalReference)}&select=id`);
  const payload = {
    order_id: orderId,
    amount: payment.amount,
    payment_method: payment.method,
    status: payment.status,
    paid_at: payment.paidAt,
    external_reference: payment.externalReference,
    notes: payment.notes,
    updated_at: new Date().toISOString(),
  };
  if (existing?.[0]?.id) {
    await dbRequest(`payments?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  } else {
    await dbRequest('payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

export async function logIntegration(orderId: string | null, provider: string, eventType: string, ok: boolean, detail = '', externalId = '') {
  try {
    await dbRequest('store_integration_events', {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId, provider, event_type: eventType, external_id: externalId || null, ok, detail: detail.slice(0, 1500) || null }),
    });
  } catch (error) {
    console.error('Integration log failed', error);
  }
}

export async function getIntegrationToken(provider: 'bling' | 'melhorenvio') {
  const rows = await dbRequest(`integration_tokens?provider=eq.${provider}&select=*`);
  return rows?.[0] ?? null;
}

export async function saveIntegrationToken(provider: 'bling' | 'melhorenvio', token: Record<string, any>) {
  const expiresIn = Number(token.expires_in) || 3600;
  const expiresAt = new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000).toISOString();
  await dbRequest('integration_tokens?on_conflict=provider', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      provider,
      access_token: token.access_token,
      refresh_token: token.refresh_token || null,
      token_type: token.token_type || 'Bearer',
      scope: Array.isArray(token.scope) ? token.scope.join(' ') : (token.scope || null),
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }),
  });
}
