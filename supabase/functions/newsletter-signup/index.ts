import { cleanText, handleOptions, json, parseJson, PublicError, publicErrorResponse } from '../_shared/core.ts';
import { dbRequest } from '../_shared/db.ts';
import { enqueueEmail } from '../_shared/email.ts';

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
    // Campo invisível preenchido por robôs comuns. A resposta neutra não
    // revela que o envio foi descartado.
    if (cleanText(body?.website, 200)) return json({ ok: true });
    const name = cleanText(body?.name, 120);
    const email = validateEmail(body?.email);
    if (name.length < 2) throw new PublicError('Informe seu nome.');

    const suppressions = await dbRequest(`email_suppressions?email=eq.${encodeURIComponent(email)}&select=reason`);
    if (['bounced', 'complained', 'manual'].includes(String(suppressions?.[0]?.reason || ''))) {
      return json({ ok: true });
    }

    const now = new Date().toISOString();
    const subscribers = await dbRequest('newsletter_subscribers?on_conflict=email', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
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

    const subscriber = subscribers?.[0];
    if (!subscriber?.id || !subscriber?.unsubscribe_token) {
      throw new PublicError('Não foi possível confirmar o cadastro.', 500);
    }

    // Um novo cadastro remove apenas uma desistência anterior. Endereços com
    // bounce ou denúncia de spam permanecem bloqueados para proteger o domínio.
    await dbRequest(`email_suppressions?email=eq.${encodeURIComponent(email)}&reason=eq.unsubscribed`, {
      method: 'DELETE',
    });

    const unsubscribeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/newsletter-unsubscribe?token=${subscriber.unsubscribe_token}`;
    try {
      await enqueueEmail({
        category: 'marketing',
        templateKey: 'newsletter_welcome',
        recipientEmail: email,
        recipientName: name,
        senderKind: 'customer',
        subject: 'Bem-vindo à Itajaó — café fresco e novidades',
        payload: { name, unsubscribe_url: unsubscribeUrl },
        idempotencyKey: `newsletter:welcome:${subscriber.id}`,
        resourceType: 'newsletter_subscriber',
        resourceId: subscriber.id,
        priority: 80,
      });
    } catch (emailError) {
      console.error('Newsletter welcome queue failed', emailError);
    }

    return json({ ok: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
});
