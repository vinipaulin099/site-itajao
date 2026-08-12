import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3';
import { env, json, safeEqual } from '../_shared/core.ts';
import { EmailOutboxRow, enqueueEmail, sendWithResend, senderAddress } from '../_shared/email.ts';

function serviceKey() {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')?.trim() || '';
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      const key = String(parsed?.default || '').trim();
      if (key) return key;
    } catch (error) {
      console.error('SUPABASE_SECRET_KEYS inválido', error);
    }
  }
  return env('SUPABASE_SERVICE_ROLE_KEY');
}

function allowedApiKeys() {
  const keys = new Set<string>();
  const raw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const value of parsed) if (typeof value === 'string') keys.add(value);
      } else if (parsed && typeof parsed === 'object') {
        for (const value of Object.values(parsed)) if (typeof value === 'string') keys.add(value);
      } else if (typeof parsed === 'string') {
        keys.add(parsed);
      }
    } catch {
      keys.add(raw);
    }
  }
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (anonKey) keys.add(anonKey);
  return keys;
}

function isAuthorizedCron(request: Request) {
  const supplied = request.headers.get('apikey') || '';
  return Boolean(supplied && allowedApiKeys().has(supplied));
}

function isAuthorizedManualTest(request: Request) {
  const supplied = request.headers.get('x-admin-token') || '';
  const expected = Deno.env.get('ADMIN_SETUP_TOKEN')?.trim() || '';
  return Boolean(supplied && expected) && safeEqual(supplied, expected);
}

async function queueCrmNotifications(admin: SupabaseClient, adminEmail: string, crmUrl: string) {
  const [scheduled, reviewInvites] = await Promise.all([
    admin.rpc('crm_generate_scheduled_notifications'),
    admin.rpc('crm_generate_review_invite_reminders'),
  ]);
  if (scheduled.error) console.error('Scheduled CRM notifications failed', scheduled.error);
  if (reviewInvites.error) console.error('Review invite reminders failed', reviewInvites.error);

  const monthlyQueue = await admin
    .from('crm_notifications')
    .update({ email_to: adminEmail })
    .eq('kind', 'monthly_summary')
    .is('email_sent_at', null)
    .is('email_to', null);
  if (monthlyQueue.error) console.error('Monthly CRM queue failed', monthlyQueue.error);

  const { data, error } = await admin
    .from('crm_notifications')
    .select('id,title,message,severity,email_to,email_attempts')
    .is('email_sent_at', null)
    .not('email_to', 'is', null)
    .lt('email_attempts', 5)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  let queued = 0;
  for (const row of data || []) {
    await enqueueEmail({
      category: 'internal',
      templateKey: 'crm_notification',
      recipientEmail: String(row.email_to || adminEmail),
      recipientName: 'Equipe Itajaó',
      senderKind: 'admin',
      subject: `[CRM Itajaó] ${row.title}`,
      payload: {
        title: row.title,
        message: row.message,
        severity: row.severity,
        crm_url: crmUrl,
      },
      idempotencyKey: `crm-notification:${row.id}`,
      resourceType: 'crm_notification',
      resourceId: row.id,
      priority: row.severity === 'critical' ? 5 : 20,
    });
    queued += 1;
  }
  return {
    queued,
    generated: scheduled.data ?? 0,
    review_invites_due: reviewInvites.data ?? 0,
  };
}

async function syncCrmNotification(
  admin: SupabaseClient,
  row: EmailOutboxRow,
  result: { ok: boolean; error: string },
) {
  if (row.resource_type !== 'crm_notification' || !row.resource_id) return;
  const values = result.ok
    ? { email_sent_at: new Date().toISOString(), email_attempts: row.attempts, email_error: null }
    : { email_attempts: row.attempts, email_error: result.error.slice(0, 1500) };
  const updated = await admin.from('crm_notifications').update(values).eq('id', row.resource_id);
  if (updated.error) console.error('CRM email status sync failed', updated.error);
}

async function dispatchOutbox(admin: SupabaseClient) {
  const claimed = await admin.rpc('claim_email_outbox', { p_limit: 25 });
  if (claimed.error) throw claimed.error;

  let sent = 0;
  let failed = 0;
  for (const row of (claimed.data || []) as EmailOutboxRow[]) {
    let delivery = { ok: false, status: 500, id: '', error: 'Falha desconhecida.' };
    try {
      delivery = await sendWithResend(row);
    } catch (error) {
      delivery.error = error instanceof Error ? error.message : String(error);
      console.error('Outbox delivery failed', row.id, error);
    }

    const completed = await admin.rpc('complete_email_outbox', {
      p_id: row.id,
      p_claim_token: row.claim_token,
      p_success: delivery.ok,
      p_provider_message_id: delivery.id || null,
      p_error: delivery.error || null,
    });
    if (completed.error) console.error('Outbox completion failed', row.id, completed.error);
    await syncCrmNotification(admin, row, delivery);

    if (delivery.ok) sent += 1;
    else failed += 1;
  }
  return { claimed: (claimed.data || []).length, sent, failed };
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  if (!isAuthorizedCron(request)) return json({ error: 'Não autorizado.' }, 401);

  const admin = createClient(env('SUPABASE_URL'), serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminEmail = String(
    Deno.env.get('NOTIFICATION_EMAIL_TO') || Deno.env.get('REPORT_EMAIL_TO') || '',
  ).trim();
  if (!adminEmail) return json({ error: 'Destinatário administrativo não configurado.' }, 500);
  const crmUrl = String(Deno.env.get('CRM_URL') || '').trim();

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* Corpo vazio é permitido. */ }

  if (body.test_email === true) {
    if (!isAuthorizedManualTest(request)) return json({ error: 'Teste manual não autorizado.' }, 401);
    const kind = body.sender === 'customer' ? 'customer' : 'admin';
    const result = await sendWithResend({
      id: crypto.randomUUID(),
      category: 'internal',
      template_key: 'crm_notification',
      recipient_email: adminEmail,
      recipient_name: 'Equipe Itajaó',
      sender_kind: kind,
      subject: `✅ Teste ${kind === 'customer' ? 'Site' : 'CRM'} Itajaó`,
      payload: {
        title: 'Envio de e-mail funcionando',
        message: `O remetente ${senderAddress(kind)} está configurado corretamente.`,
      },
    });
    return json({ ok: result.ok, sender: kind, status: result.status, error: result.error || null }, result.ok ? 200 : 502);
  }

  try {
    const crm = await queueCrmNotifications(admin, adminEmail, crmUrl);
    const outbox = await dispatchOutbox(admin);
    return json({ ok: true, ...crm, ...outbox });
  } catch (error) {
    console.error('Central email dispatch failed', error);
    return json({ error: 'Não foi possível processar a fila de e-mails.' }, 500);
  }
});
