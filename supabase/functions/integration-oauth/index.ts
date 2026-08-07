import { env, hmacHex, json, PublicError, publicErrorResponse, safeEqual } from '../_shared/core.ts';
import { saveIntegrationToken } from '../_shared/db.ts';
import { melhorEnvioBaseUrl } from '../_shared/tokens.ts';

type Provider = 'bling' | 'melhorenvio';

function providerFrom(url: URL): Provider {
  const value = url.searchParams.get('provider');
  if (value !== 'bling' && value !== 'melhorenvio') throw new PublicError('Integração desconhecida.', 400);
  return value;
}

async function makeState(provider: Provider) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${provider}.${timestamp}`;
  const signature = await hmacHex(env('INTEGRATION_STATE_SECRET'), payload);
  return `${payload}.${signature}`;
}

async function validateState(provider: Provider, state: string) {
  const [stateProvider, timestampRaw, signature] = state.split('.');
  const timestamp = Number(timestampRaw);
  if (stateProvider !== provider || !Number.isFinite(timestamp) || !signature) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 15 * 60) return false;
  const expected = await hmacHex(env('INTEGRATION_STATE_SECRET'), `${stateProvider}.${timestampRaw}`);
  return safeEqual(expected, signature);
}

function requireAdmin(req: Request) {
  const expected = env('ADMIN_SETUP_TOKEN');
  const received = req.headers.get('x-admin-token') || '';
  if (!received || !safeEqual(received, expected)) throw new PublicError('Não autorizado.', 401);
}

async function authorizationUrl(provider: Provider) {
  const state = await makeState(provider);
  if (provider === 'bling') {
    const url = new URL('https://www.bling.com.br/Api/v3/oauth/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', env('BLING_CLIENT_ID'));
    url.searchParams.set('state', state);
    return url.toString();
  }
  const url = new URL(`${melhorEnvioBaseUrl()}/oauth/authorize`);
  url.searchParams.set('client_id', env('ME_CLIENT_ID'));
  url.searchParams.set('redirect_uri', env('ME_REDIRECT_URI'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'shipping-calculate cart-read cart-write shipping-checkout shipping-generate shipping-print shipping-tracking shipping-cancel orders-read ecommerce-shipping');
  return url.toString();
}

async function exchangeBling(code: string) {
  const clientId = env('BLING_CLIENT_ID');
  const clientSecret = env('BLING_CLIENT_SECRET');
  const response = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'enable-jwt': '1',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new PublicError('O Bling não concluiu a autorização.', 502);
  await saveIntegrationToken('bling', data);
}

async function exchangeMelhorEnvio(code: string) {
  const response = await fetch(`${melhorEnvioBaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': env('ME_USER_AGENT') },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env('ME_CLIENT_ID'),
      client_secret: env('ME_CLIENT_SECRET'),
      redirect_uri: env('ME_REDIRECT_URI'),
      code,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new PublicError('O Melhor Envio não concluiu a autorização.', 502);
  await saveIntegrationToken('melhorenvio', data);
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const provider = providerFrom(url);
    const action = url.searchParams.get('action') || 'callback';
    if (action === 'start') {
      requireAdmin(req);
      return json({ authorizeUrl: await authorizationUrl(provider) });
    }
    const code = url.searchParams.get('code') || '';
    const state = url.searchParams.get('state') || '';
    if (!code || !(await validateState(provider, state))) throw new PublicError('Retorno OAuth inválido ou expirado.', 401);
    if (provider === 'bling') await exchangeBling(code); else await exchangeMelhorEnvio(code);
    return new Response('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Integração concluída</title><body style="font-family:Arial,sans-serif;padding:40px;color:#3D2B1F"><h1>Integração concluída ✓</h1><p>A autorização foi salva com segurança. Você já pode fechar esta aba.</p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    return publicErrorResponse(error);
  }
});

