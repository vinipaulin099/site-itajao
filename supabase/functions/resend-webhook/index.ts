import { Webhook } from 'npm:svix@1.99.1';
import { env, json } from '../_shared/core.ts';
import { dbRequest } from '../_shared/db.ts';

function firstRecipient(data: Record<string, unknown>) {
  const recipients = Array.isArray(data.to) ? data.to : [];
  return String(recipients[0] || data.email || '').trim().toLowerCase();
}

function eventSnapshot(event: Record<string, any>) {
  const data = event.data || {};
  const snapshot: Record<string, unknown> = {
    subject: String(data.subject || '').slice(0, 180),
    to: Array.isArray(data.to) ? data.to.slice(0, 5) : [],
    tags: data.tags && typeof data.tags === 'object' ? data.tags : {},
  };
  if (data.bounce) {
    snapshot.bounce = {
      type: String(data.bounce.type || '').slice(0, 80),
      subType: String(data.bounce.subType || '').slice(0, 120),
      message: String(data.bounce.message || '').slice(0, 500),
    };
  }
  if (data.suppression) {
    snapshot.suppression = { reason: String(data.suppression.reason || '').slice(0, 160) };
  }
  if (data.click?.link) snapshot.clicked_link = String(data.click.link).slice(0, 1000);
  return snapshot;
}

async function suppressRecipient(email: string, reason: 'bounced' | 'complained') {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  const now = new Date().toISOString();
  await dbRequest('email_suppressions?on_conflict=email', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      email,
      reason,
      source: 'resend_webhook',
      detail: reason === 'complained' ? 'Destinatário marcou a mensagem como spam.' : 'Endereço retornou bounce permanente ou foi suprimido.',
      updated_at: now,
    }),
  });
  await dbRequest(`newsletter_subscribers?email=eq.${encodeURIComponent(email)}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: false, updated_at: now }),
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  const raw = await req.text();
  const eventId = req.headers.get('svix-id') || '';
  const timestamp = req.headers.get('svix-timestamp') || '';
  const signature = req.headers.get('svix-signature') || '';
  if (!eventId || !timestamp || !signature) return json({ error: 'Assinatura ausente.' }, 400);

  let event: Record<string, any>;
  try {
    const webhook = new Webhook(env('RESEND_WEBHOOK_SECRET'));
    event = webhook.verify(raw, {
      'svix-id': eventId,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    }) as Record<string, any>;
  } catch (error) {
    console.error('Invalid Resend webhook', error);
    return json({ error: 'Assinatura inválida.' }, 400);
  }

  try {
    const type = String(event.type || 'unknown').slice(0, 120);
    const data = event.data || {};
    const messageId = String(data.email_id || '').slice(0, 200) || null;
    const occurredAt = new Date(String(event.created_at || Date.now())).toISOString();
    let outboxId: string | null = null;

    if (messageId) {
      const rows = await dbRequest(`email_outbox?provider_message_id=eq.${encodeURIComponent(messageId)}&select=id`);
      outboxId = rows?.[0]?.id || null;
    }

    await dbRequest('email_events?on_conflict=provider_event_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        outbox_id: outboxId,
        provider: 'resend',
        provider_event_id: eventId,
        provider_message_id: messageId,
        event_type: type,
        occurred_at: occurredAt,
        event_data: eventSnapshot(event),
      }),
    });

    if (messageId && ['email.failed', 'email.bounced', 'email.complained', 'email.suppressed'].includes(type)) {
      await dbRequest(`email_outbox?provider_message_id=eq.${encodeURIComponent(messageId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ provider_error: `Evento Resend: ${type}` }),
      });
    }

    const recipient = firstRecipient(data);
    if (type === 'email.complained') await suppressRecipient(recipient, 'complained');
    if (type === 'email.bounced' || type === 'email.suppressed') await suppressRecipient(recipient, 'bounced');

    return json({ ok: true });
  } catch (error) {
    console.error('Resend webhook processing failed', error);
    return json({ error: 'Falha ao registrar o evento.' }, 500);
  }
});
