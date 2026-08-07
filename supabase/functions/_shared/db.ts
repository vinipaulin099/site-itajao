import { env, PublicError } from './core.ts';

function dbHeaders(extra: HeadersInit = {}) {
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
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

export async function insertOrder(payload: Record<string, unknown>) {
  const rows = await dbRequest('store_orders', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  return rows?.[0];
}

export async function getOrder(id: string) {
  const rows = await dbRequest(`store_orders?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] ?? null;
}

export async function getPublicOrder(id: string, token: string) {
  const rows = await dbRequest(`store_orders?id=eq.${encodeURIComponent(id)}&public_token=eq.${encodeURIComponent(token)}&select=id,order_number,status,total,mp_payment_status,tracking_code,created_at`);
  return rows?.[0] ?? null;
}

export async function updateOrder(id: string, payload: Record<string, unknown>) {
  const rows = await dbRequest(`store_orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  return rows?.[0] ?? null;
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

