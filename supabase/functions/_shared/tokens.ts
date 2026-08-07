import { env, PublicError } from './core.ts';
import { getIntegrationToken, saveIntegrationToken } from './db.ts';

type Provider = 'bling' | 'melhorenvio';

function tokenStillValid(row: any) {
  if (!row?.access_token) return false;
  if (!row.expires_at) return true;
  return new Date(row.expires_at).getTime() > Date.now() + 5 * 60 * 1000;
}

async function refreshBling(refreshToken: string) {
  const clientId = env('BLING_CLIENT_ID');
  const clientSecret = env('BLING_CLIENT_SECRET');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const response = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'enable-jwt': '1',
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new PublicError('Não foi possível renovar a autorização do Bling.', 503);
  await saveIntegrationToken('bling', data);
  return data.access_token as string;
}

function melhorEnvioBaseUrl() {
  return Deno.env.get('ME_ENV') === 'production' ? 'https://melhorenvio.com.br' : 'https://sandbox.melhorenvio.com.br';
}

async function refreshMelhorEnvio(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env('ME_CLIENT_ID'),
    client_secret: env('ME_CLIENT_SECRET'),
    refresh_token: refreshToken,
  });
  const response = await fetch(`${melhorEnvioBaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': env('ME_USER_AGENT'),
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new PublicError('Não foi possível renovar a autorização do Melhor Envio.', 503);
  await saveIntegrationToken('melhorenvio', data);
  return data.access_token as string;
}

export async function providerToken(provider: Provider) {
  const direct = Deno.env.get(provider === 'bling' ? 'BLING_ACCESS_TOKEN' : 'ME_ACCESS_TOKEN')?.trim();
  if (direct) return direct;
  const row = await getIntegrationToken(provider);
  if (tokenStillValid(row)) return row.access_token as string;
  if (!row?.refresh_token) throw new PublicError(`A integração com ${provider === 'bling' ? 'o Bling' : 'o Melhor Envio'} ainda não foi autorizada.`, 503);
  return provider === 'bling' ? refreshBling(row.refresh_token) : refreshMelhorEnvio(row.refresh_token);
}

export { melhorEnvioBaseUrl };

