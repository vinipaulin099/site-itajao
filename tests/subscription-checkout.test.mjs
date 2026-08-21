import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  config,
  page,
  frontend,
  statusPage,
  statusFrontend,
  createFunction,
  webhookFunction,
  statusFunction,
  promotions,
  emailTemplates,
  migration,
  supabaseConfig,
] = await Promise.all([
  readFile(new URL('../assets/js/subscription-config.js', import.meta.url), 'utf8'),
  readFile(new URL('../assinatura-checkout.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/js/subscription-checkout.js', import.meta.url), 'utf8'),
  readFile(new URL('../assinatura-status.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/js/subscription-status.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/create-subscription-checkout/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/mercadopago-subscription-webhook/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/subscription-status/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/_shared/promotions.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/_shared/email.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260821232000_subscription_checkout_core.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
]);

test('mantém o checkout do clube fechado até a homologação em duas camadas', () => {
  assert.match(config, /enabled:false/);
  assert.match(config, /url:'assinatura-checkout\.html'/);
  assert.match(createFunction, /SUBSCRIPTION_CHECKOUT_ENABLED/);
  assert.match(createFunction, /MP_USE_SANDBOX/);
  assert.match(createFunction, /x-admin-token/);
});

test('calcula preço no servidor e nunca aceita cupom ou frete na assinatura', () => {
  assert.match(createFunction, /if \(body\?\.couponCode\)/);
  assert.match(createFunction, /body\?\.acceptedTerms !== true/);
  assert.match(page, /id="subscriptionConsent"[\s\S]*?required/);
  assert.match(migration, /terms_accepted_at timestamptz not null/);
  assert.match(createFunction, /createSubscriptionCheckout/);
  assert.doesNotMatch(frontend, /unitPriceCents\s*:/);
  assert.doesNotMatch(frontend, /totalCents\s*:/);
  assert.doesNotMatch(page, /<input[^>]+coupon/i);
  assert.match(migration, /\('monthly-500',[\s\S]*?8890/);
  assert.match(migration, /\('monthly-1000',[\s\S]*?14990/);
  assert.match(migration, /\('annual-500',[\s\S]*?7490/);
  assert.match(migration, /\('annual-1000',[\s\S]*?13690/);
  assert.match(migration, /pix_discount_bps[\s\S]*?default 500/);
  assert.match(migration, /shipping_amount_cents integer not null default 0 check \(shipping_amount_cents = 0\)/);
  assert.match(migration, /check \(coupon_code is null\)/);
});

test('protege tentativas e webhooks contra processamento duplicado', () => {
  assert.match(migration, /client_request_id uuid not null unique/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /unique \(provider, provider_payment_id\)/);
  assert.match(migration, /subscription_payments_authorized_payment_uidx/);
  assert.match(createFunction, /'X-Idempotency-Key': subscription\.id/);
  assert.match(webhookFunction, /verifySignature/);
  assert.match(webhookFunction, /hmacHex/);
  assert.match(webhookFunction, /should_stop_recurring/);
  assert.match(webhookFunction, /status: 'canceled'/);
});

test('gera a jornada PIX, retorno da recorrência e acompanhamento privado', () => {
  assert.match(page, /id="pixResult"/);
  assert.match(frontend, /qrCodeBase64/);
  assert.match(frontend, /Copiar código PIX|copyPixButton/);
  assert.match(createFunction, /subscriptionReturnUrl/);
  assert.match(createFunction, /statusUrl/);
  assert.match(statusPage, /id="shipmentTimeline"/);
  assert.match(statusFrontend, /subscription-status/);
  assert.match(statusFunction, /getPublicSubscription\(id, token\)/);
  assert.doesNotMatch(statusFunction, /customer_snapshot|delivery_address/);
});

test('entrega e protege o benefício de 10% em compras extras', () => {
  assert.match(migration, /create table if not exists public\.subscription_benefit_coupons/);
  assert.match(migration, /'percent', 10/);
  assert.match(migration, /Cupom exclusivo do titular da assinatura/);
  assert.match(migration, /v_status <> 'active'/);
  assert.match(promotions, /subscription_benefit_coupons/);
  assert.match(promotions, /exclusivo do titular da assinatura/);
  assert.match(statusFunction, /benefitCode/);
  assert.match(emailTemplates, /subscription_payment_approved/);
  assert.match(emailTemplates, /10% OFF EM COMPRAS EXTRAS/);
});

test('declara as três funções públicas do checkout no Supabase', () => {
  for (const name of ['create-subscription-checkout', 'mercadopago-subscription-webhook', 'subscription-status']) {
    assert.match(supabaseConfig, new RegExp(`\\[functions\\.${name}\\]\\nverify_jwt = false`));
  }
});
