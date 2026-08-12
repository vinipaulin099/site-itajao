import { env, handleOptions, json, parseJson, PublicError, publicErrorResponse } from '../_shared/core.ts';
import { dbRequest } from '../_shared/db.ts';

function validToken(value: unknown) {
  const token = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) {
    throw new PublicError('Link de descadastro inválido.', 400);
  }
  return token;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const token = encodeURIComponent(String(url.searchParams.get('token') || ''));
    return Response.redirect(`${env('SITE_URL').replace(/\/+$/, '')}/cancelar-inscricao.html?token=${token}`, 302);
  }
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    let body: Record<string, unknown> = {};
    try { body = await parseJson(req); } catch { /* One-click pode enviar corpo vazio. */ }
    const token = validToken(url.searchParams.get('token') || body?.token);
    const subscribers = await dbRequest(`newsletter_subscribers?unsubscribe_token=eq.${encodeURIComponent(token)}&select=id,email`);
    const subscriber = subscribers?.[0];
    if (!subscriber) return json({ ok: true });

    const now = new Date().toISOString();
    await dbRequest(`newsletter_subscribers?id=eq.${encodeURIComponent(subscriber.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: false, unsubscribed_at: now, updated_at: now }),
    });
    await dbRequest('email_suppressions?on_conflict=email', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        email: String(subscriber.email).toLowerCase(),
        reason: 'unsubscribed',
        source: 'newsletter_link',
        detail: 'Descadastro solicitado pelo destinatário.',
        updated_at: now,
      }),
    });
    return json({ ok: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
});
