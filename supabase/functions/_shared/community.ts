import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3';
import { cleanText, env, PublicError, safeEqual } from './core.ts';
import { adminRecipientEmail, enqueueEmail } from './email.ts';

const MEDIA_BUCKET = 'community-media';
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

let cachedAdmin: SupabaseClient | null = null;

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

export function adminClient() {
  if (!cachedAdmin) {
    cachedAdmin = createClient(env('SUPABASE_URL'), serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedAdmin;
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomLinkToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomReviewCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

export function normalizeLinkToken(value: unknown) {
  const token = cleanText(value, 80);
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) throw new PublicError('Convite inválido ou expirado.', 404);
  return token;
}

export function normalizeReviewCode(value: unknown) {
  const code = String(value ?? '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) throw new PublicError('Informe o código de 6 dígitos.');
  return code;
}

export function normalizeEmail(value: unknown) {
  const email = cleanText(value, 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PublicError('Informe um e-mail válido.');
  return email;
}

export function splitName(firstValue: unknown, lastValue: unknown) {
  const firstName = cleanText(firstValue, 80);
  const lastName = cleanText(lastValue, 100);
  if (firstName.length < 1) throw new PublicError('Informe seu nome.');
  return { firstName, lastName: lastName || null };
}

export async function hashesForInvite(token: string, code: string) {
  const [tokenHash, codeHash] = await Promise.all([
    sha256Hex(token),
    sha256Hex(`${token}:${code}`),
  ]);
  return { tokenHash, codeHash };
}

export function extensionForMime(mime: string) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

export function validateImage(file: File | null) {
  if (!file || file.size === 0) return null;
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new PublicError('A foto deve ser JPG, PNG ou WebP.');
  if (file.size > MAX_IMAGE_BYTES) throw new PublicError('A foto pode ter no máximo 6 MB.');
  return file;
}

export async function uploadImage(file: File, folder: string) {
  validateImage(file);
  const path = `${folder}/${crypto.randomUUID()}.${extensionForMime(file.type)}`;
  const { error } = await adminClient().storage
    .from(MEDIA_BUCKET)
    .upload(path, new Uint8Array(await file.arrayBuffer()), {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    });
  if (error) {
    console.error('Community media upload failed', error);
    throw new PublicError('Não foi possível enviar a foto. Tente novamente.', 500);
  }
  return path;
}

export async function removeImages(paths: Array<string | null | undefined>) {
  const valid = paths.filter((path): path is string => Boolean(path));
  if (!valid.length) return;
  const { error } = await adminClient().storage.from(MEDIA_BUCKET).remove(valid);
  if (error) console.error('Community media cleanup failed', error);
}

export async function signedImageUrl(path: string | null, expiresIn = 3600) {
  if (!path) return null;
  const { data, error } = await adminClient().storage.from(MEDIA_BUCKET).createSignedUrl(path, expiresIn);
  if (error) {
    console.error('Community signed URL failed', error);
    return null;
  }
  return data.signedUrl;
}

export async function requireAdmin(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new PublicError('Faça login como administrador.', 401);

  const admin = adminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new PublicError('Sessão inválida ou expirada.', 401);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('user_id,role,active')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.role !== 'admin' || !profile.active) {
    throw new PublicError('Acesso permitido somente para administradores.', 403);
  }
  return { userId: userData.user.id, email: userData.user.email || '' };
}

export async function verifyInvite(tokenValue: unknown, codeValue: unknown) {
  const token = normalizeLinkToken(tokenValue);
  const code = normalizeReviewCode(codeValue);
  const { tokenHash, codeHash } = await hashesForInvite(token, code);
  const admin = adminClient();

  const { data: invite, error } = await admin
    .from('review_invites')
    .select('*')
    .eq('link_token_hash', tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!invite) throw new PublicError('Convite inválido ou expirado.', 404);

  if (invite.status !== 'pending') {
    const message = invite.status === 'used'
      ? 'Esta avaliação já foi enviada.'
      : 'Este convite não está mais disponível.';
    throw new PublicError(message, 409);
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    await admin.from('review_invites').update({ status: 'expired' }).eq('id', invite.id);
    throw new PublicError('Este convite expirou. Peça um novo link à Itajaó.', 410);
  }
  if (Number(invite.attempts) >= Number(invite.max_attempts)) {
    await admin.from('review_invites').update({ status: 'locked' }).eq('id', invite.id);
    throw new PublicError('O limite de tentativas foi atingido. Peça um novo código.', 429);
  }

  if (!safeEqual(String(invite.code_hash), codeHash)) {
    const attempts = Number(invite.attempts) + 1;
    const locked = attempts >= Number(invite.max_attempts);
    await admin.from('review_invites').update({
      attempts,
      status: locked ? 'locked' : 'pending',
      last_attempt_at: new Date().toISOString(),
    }).eq('id', invite.id);
    if (locked) throw new PublicError('Código incorreto. O convite foi bloqueado após 5 tentativas.', 429);
    throw new PublicError(`Código incorreto. Restam ${Number(invite.max_attempts) - attempts} tentativas.`, 401);
  }

  await admin.from('review_invites').update({
    verified_at: new Date().toISOString(),
    last_attempt_at: new Date().toISOString(),
  }).eq('id', invite.id);

  return { token, code, invite };
}

export async function notifyAdmins(input: {
  kind: 'review_received' | 'recipe_received';
  title: string;
  message: string;
  eventKey: string;
  metadata?: Record<string, unknown>;
  templateKey: 'admin_review_received' | 'admin_recipe_received';
  resourceType: 'review' | 'recipe';
  resourceId: string;
}) {
  const admin = adminClient();
  const { data: profiles, error } = await admin
    .from('profiles')
    .select('user_id')
    .eq('role', 'admin')
    .eq('active', true);
  if (error) {
    console.error('Admin profile lookup failed', error);
  } else if (profiles?.length) {
    const rows = profiles.map((profile) => ({
      recipient_user_id: profile.user_id,
      recipient_reseller_id: null,
      kind: input.kind,
      severity: 'info',
      title: input.title,
      message: input.message,
      event_key: input.eventKey,
      metadata: input.metadata || {},
    }));
    const inserted = await admin.from('crm_notifications').upsert(rows, {
      onConflict: 'recipient_user_id,event_key',
      ignoreDuplicates: true,
    });
    if (inserted.error) console.error('CRM community notification failed', inserted.error);
  }

  const adminEmail = await adminRecipientEmail();
  if (!adminEmail) {
    console.error('Admin community email recipient is not configured');
    return;
  }
  const siteUrl = String(Deno.env.get('SITE_URL') || 'https://cafeitajao.com.br').replace(/\/+$/, '');
  const crmUrl = String(Deno.env.get('CRM_URL') || `${siteUrl}/admin-comunidade.html`).trim();
  await enqueueEmail({
    category: 'internal',
    templateKey: input.templateKey,
    recipientEmail: adminEmail,
    recipientName: 'Equipe Itajaó',
    senderKind: 'admin',
    subject: `[CRM Itajaó] ${input.title}`,
    payload: { title: input.title, message: input.message, crm_url: crmUrl },
    idempotencyKey: `admin:${input.eventKey}`,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    priority: 25,
  });
}
