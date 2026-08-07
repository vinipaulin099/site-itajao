import { cleanText, handleOptions, json, parseJson, PublicError, publicErrorResponse } from '../_shared/core.ts';
import { dbRequest } from '../_shared/db.ts';

function validateEmail(value: unknown) {
  const email = cleanText(value, 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PublicError('E-mail inválido.');
  return email;
}

function sourceName(value: unknown) {
  const source = cleanText(value, 50).toLowerCase();
  return ['popup_home', 'popup_produto'].includes(source) ? source : 'site_itajao';
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const body = await parseJson(req);
    const name = cleanText(body?.name, 120);
    const email = validateEmail(body?.email);
    if (name.length < 2) throw new PublicError('Informe seu nome.');

    const now = new Date().toISOString();
    await dbRequest('newsletter_subscribers?on_conflict=email', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        name,
        email,
        source: sourceName(body?.source),
        is_active: true,
        consent_at: now,
        unsubscribed_at: null,
        updated_at: now,
      }),
    });

    return json({ ok: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
});
