import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [home, store, homeStore, catalogPage, brandStyles, reviewPage, reviewScript, reviewFunction, feedFunction, adminFunction, dispatchFunction, reviewProductMigration] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/js/store.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/js/home-store.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/js/catalog-page.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/css/brand-refresh.css', import.meta.url), 'utf8'),
  readFile(new URL('../avaliar.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/js/review-form.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/community-review/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/community-feed/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/community-admin/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/crm-notification-dispatch/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260821035059_canonicalize_legacy_500g_review_links.sql', import.meta.url), 'utf8'),
]);

test('mantém os dois cafés de 500 g em R$ 59,90', () => {
  assert.equal((store.match(/price:59\.90/g) || []).length, 2);
  assert.equal((home.match(/R\$&nbsp;59,90/g) || []).length, 2);
});

test('protege o disparador de e-mails com segredo interno', () => {
  assert.match(dispatchFunction, /x-cron-secret/);
  assert.match(dispatchFunction, /internal_dispatch_secrets/);
  assert.doesNotMatch(dispatchFunction, /SUPABASE_PUBLISHABLE_KEYS|SUPABASE_ANON_KEY/);
});

test('exibe receitas aprovadas na página inicial', () => {
  assert.match(home, /id="homeCommunityRecipes"/);
  assert.match(home, /Receitas da Comunidade/);
  assert.match(home, /enviar-receita\.html/);
});

test('abre a avaliação pelo link individual e convida para enviar receita', () => {
  assert.doesNotMatch(reviewPage, /reviewCode|Confirmar chave|Chave de 6 caracteres/);
  assert.match(reviewPage, /Compartilhar minha receita/);
  assert.match(reviewScript, /direct: true/);
  assert.doesNotMatch(reviewScript, /formData\.append\('code'/);
  assert.match(reviewFunction, /verifyInviteByToken/);
  assert.doesNotMatch(adminFunction, /Chave de acesso:/);
  assert.match(adminFunction, /https:\/\/www\.cafeitajao\.com\.br/);
  assert.match(adminFunction, /parsed\.hostname = 'www\.cafeitajao\.com\.br'/);
});

test('consolida avaliações dos SKUs antigos nos cafés atuais de 500 g', () => {
  assert.match(reviewProductMigration, /ITAJAO-500-MOIDO/);
  assert.match(reviewProductMigration, /ITAJAO-MOIDO-500/);
  assert.match(reviewProductMigration, /update public\.order_items/);
  assert.match(reviewProductMigration, /update public\.product_reviews/);
});

test('exibe média e quantidade de avaliações nos cards de café', () => {
  assert.match(home, /data-review-sku="ITAJAO-GRAOS-500"/);
  assert.match(home, /data-review-sku="ITAJAO-MOIDO-500"/);
  assert.match(store, /loadReviewSummaries/);
  assert.match(store, /renderReviewSummary/);
  assert.match(homeStore, /loadReviewSummaries/);
  assert.match(catalogPage, /data-review-sku/);
  assert.match(brandStyles, /--itajao-rating-gold:#d4a017/);
  assert.match(brandStyles, /\.product-rating-stars\.has-rating\{color:var\(--itajao-rating-gold\)/);
  assert.match(feedFunction, /review_summaries/);
  assert.match(feedFunction, /product_reviews/);
});
