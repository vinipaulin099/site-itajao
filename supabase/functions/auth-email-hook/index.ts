import { Webhook } from 'npm:standardwebhooks@1.0.0';
import { env, json } from '../_shared/core.ts';
import { dbRequest } from '../_shared/db.ts';
import { enqueueEmail, sendWithResend } from '../_shared/email.ts';

type HookPayload = {
  user: { id: string; email: string; user_metadata?: Record<string, unknown> };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

function emailCopy(action: string) {
  if (action === 'recovery') return { subject: 'Redefina sua senha no CRM Itajaó', title: 'Redefinição de senha', message: 'Recebemos um pedido para redefinir sua senha. Use o botão abaixo para continuar.', label: 'Redefinir senha' };
  if (action === 'invite') return { subject: 'Convite para acessar o CRM Itajaó', title: 'Você foi convidado para o CRM', message: 'Seu acesso ao CRM Itajaó foi criado. Use o botão abaixo para definir sua senha e entrar.', label: 'Aceitar convite' };
  if (action === 'magiclink') return { subject: 'Seu acesso ao CRM Itajaó', title: 'Link de acesso', message: 'Use o botão abaixo para entrar com segurança no CRM Itajaó.', label: 'Entrar no CRM' };
  if (action === 'email_change') return { subject: 'Confirme seu novo e-mail no CRM Itajaó', title: 'Confirme a alteração de e-mail', message: 'Use o botão abaixo para confirmar seu novo endereço de e-mail.', label: 'Confirmar e-mail' };
  if (action === 'reauthentication') return { subject: 'Código de segurança do CRM Itajaó', title: 'Confirmação de segurança', message: 'Use o código abaixo para confirmar esta ação no CRM Itajaó.', label: '' };
  return { subject: 'Confirme seu acesso ao CRM Itajaó', title: 'Confirme seu e-mail', message: 'Use o botão abaixo para confirmar seu endereço de e-mail.', label: 'Confirmar e-mail' };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  const raw = await req.text();
  let payload: HookPayload;
  try {
    const secret = env('SEND_EMAIL_HOOK_SECRET').replace('v1,whsec_', '');
    payload = new Webhook(secret).verify(raw, Object.fromEntries(req.headers)) as HookPayload;
  } catch (error) {
    console.error('Invalid Auth email hook', error);
    return json({ error: { http_code: 401, message: 'Assinatura inválida.' } }, 401);
  }

  try {
    const { user, email_data: emailData } = payload;
    const copy = emailCopy(emailData.email_action_type);
    const verifyUrl = new URL(`${env('SUPABASE_URL')}/auth/v1/verify`);
    verifyUrl.searchParams.set('token', emailData.token_hash);
    verifyUrl.searchParams.set('type', emailData.email_action_type);
    verifyUrl.searchParams.set('redirect_to', emailData.redirect_to || env('SITE_URL'));
    const displayName = String(user.user_metadata?.display_name || user.email.split('@')[0]);
    const message = emailData.email_action_type === 'reauthentication'
      ? `${copy.message}\n\nCódigo: ${emailData.token}`
      : copy.message;
    const outboxId = String(await enqueueEmail({
      category: 'auth',
      templateKey: 'auth_message',
      recipientEmail: user.email.toLowerCase(),
      recipientName: displayName,
      senderKind: 'customer',
      subject: copy.subject,
      payload: {
        title: copy.title,
        message,
        action_url: emailData.email_action_type === 'reauthentication' ? '' : verifyUrl.toString(),
        action_label: copy.label,
      },
      idempotencyKey: `auth:${emailData.email_action_type}:${user.id}:${emailData.token_hash}`,
      resourceType: 'auth_user',
      resourceId: user.id,
      priority: 0,
    }));

    const existingRows = await dbRequest(`email_outbox?id=eq.${encodeURIComponent(outboxId)}&select=status,attempts`);
    const existing = existingRows?.[0];
    if (existing?.status === 'sent' || existing?.status === 'processing') return json({});
    if (!existing || !['pending', 'failed'].includes(existing.status)) {
      throw new Error(`E-mail de autenticação indisponível: ${String(existing?.status || 'não encontrado')}`);
    }

    // O hook precisa responder de forma síncrona ao Auth. Reservamos a linha
    // antes do envio para que o cron da fila não dispare a mesma mensagem.
    const claimToken = crypto.randomUUID();
    const attempt = Number(existing.attempts || 0) + 1;
    const claimedRows = await dbRequest(`email_outbox?id=eq.${encodeURIComponent(outboxId)}&status=in.(pending,failed)`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'processing', attempts: attempt, claim_token: claimToken,
        claimed_at: new Date().toISOString(), next_attempt_at: null,
      }),
    });
    if (!claimedRows?.[0]) return json({});

    const row = {
      id: outboxId,
      category: 'auth' as const,
      template_key: 'auth_message',
      recipient_email: user.email.toLowerCase(),
      recipient_name: displayName,
      sender_kind: 'customer' as const,
      subject: copy.subject,
      payload: {
        title: copy.title,
        message,
        action_url: emailData.email_action_type === 'reauthentication' ? '' : verifyUrl.toString(),
        action_label: copy.label,
      },
    };
    const sent = await sendWithResend(row);
    await dbRequest(`email_outbox?id=eq.${encodeURIComponent(outboxId)}&claim_token=eq.${encodeURIComponent(claimToken)}`, {
      method: 'PATCH',
      body: JSON.stringify(sent.ok ? {
        status: 'sent', provider_message_id: sent.id, provider_error: null,
        next_attempt_at: null, sent_at: new Date().toISOString(), claimed_at: null, claim_token: null,
      } : {
        status: 'failed', provider_error: sent.error, claimed_at: null, claim_token: null,
        next_attempt_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      }),
    });
    if (!sent.ok) throw new Error(sent.error || `Resend ${sent.status}`);
    return json({});
  } catch (error) {
    console.error('Auth email send failed', error);
    return json({ error: { http_code: 500, message: 'Não foi possível enviar o e-mail de acesso.' } }, 500);
  }
});
