(function () {
  'use strict';
  const config = window.ITAJAO_STORE_CONFIG || {};
  const grid = document.getElementById('productReviews');
  const summary = document.getElementById('productReviewSummary');
  let loadedKey = '';

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
    });
  }
  function safeUrl(value) {
    try { const url = new URL(String(value || ''), location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
    catch (error) { return ''; }
  }
  function stars(rating) { const value = Math.max(0, Math.min(5, Number(rating) || 0)); return '★'.repeat(value) + '☆'.repeat(5 - value); }
  function card(review) {
    const photo = safeUrl(review.image_url);
    return '<article class="public-review-card"><span class="review-stars" role="img" aria-label="' + Number(review.rating) + ' de 5 estrelas">' + stars(review.rating) + '</span>' +
      (review.title ? '<h3>' + escapeHtml(review.title) + '</h3>' : '') + '<p>' + escapeHtml(review.comment) + '</p>' +
      (photo ? '<img src="' + escapeHtml(photo) + '" alt="Foto enviada na avaliação" loading="lazy">' : '') +
      (review.admin_response ? '<div class="public-brand-response"><strong>Itajaó respondeu</strong><br>' + escapeHtml(review.admin_response) + '</div>' : '') +
      '<div class="public-review-meta"><span>' + escapeHtml(review.reviewer || 'Cliente Itajaó') + '</span><strong>Compra verificada</strong></div></article>';
  }
  async function load(key) {
    if (!key || key === loadedKey) return;
    loadedKey = key;
    try {
      const base = String(config.functionsBaseUrl || '').replace(/\/+$/, '');
      const publicKey = String(config.supabasePublishableKey || '');
      const response = await fetch(base + '/community-feed?type=reviews&product=' + encodeURIComponent(key) + '&limit=6', { headers: { apikey: publicKey, Authorization: 'Bearer ' + publicKey } });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar as avaliações.');
      const items = Array.isArray(data.items) ? data.items : [];
      grid.innerHTML = items.length ? items.map(card).join('') : '<div class="reviews-empty">Este café ainda não tem avaliações publicadas.<br><a class="reviews-link" href="comunidade.html">Conheça as experiências da Comunidade Itajaó →</a></div>';
      if (Number(data.total || 0) > 0) {
        summary.hidden = false;
        document.getElementById('productReviewAverage').textContent = Number(data.average || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        document.getElementById('productReviewCount').textContent = Number(data.total) === 1 ? '1 avaliação verificada' : Number(data.total) + ' avaliações verificadas';
      }
    } catch (error) {
      grid.innerHTML = '<div class="reviews-empty">' + escapeHtml(error.message) + '</div>';
    }
  }
  window.addEventListener('itajao:product-rendered', function (event) { load(event.detail && event.detail.key); });
  if (window.ITAJAO_CURRENT_PRODUCT) load(window.ITAJAO_CURRENT_PRODUCT.key);
})();
