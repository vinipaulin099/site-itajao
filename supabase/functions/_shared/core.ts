export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-admin-token, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export class PublicError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export function handleOptions(req: Request) {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null;
}

export function env(name: string, required = true): string {
  const value = Deno.env.get(name)?.trim() ?? '';
  if (required && !value) throw new PublicError(`Configuração pendente no servidor: ${name}.`, 503);
  return value;
}

export function commerceEnabled() {
  if (Deno.env.get('COMMERCE_ENABLED') !== 'true') {
    throw new PublicError('O novo checkout está em configuração. Por enquanto, finalize sua compra pela loja atual.', 503);
  }
}

export function digits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

export function cleanText(value: unknown, maxLength: number) {
  return String(value ?? '').trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, maxLength);
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function parseJson(req: Request) {
  try {
    return await req.json();
  } catch {
    throw new PublicError('JSON inválido.', 400);
  }
}

export function publicErrorResponse(error: unknown) {
  if (error instanceof PublicError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: 'Não foi possível concluir a operação agora. Tente novamente em instantes.' }, 500);
}

export async function hmacHex(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

