(function () {
  'use strict';
  const grid = document.getElementById('homeCommunityReviews');
  const config = window.ITAJAO_STORE_CONFIG || {};
  if (!grid) return;
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]; });
  }
  function initials(name) {
    return String(name || 'Cliente Itajaó').split(/\s+/).slice(0, 2).map(function (part) { return part.charAt(0); }).join('').toUpperCase();
  }
  function card(review, index) {
    const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
    return '<article class="dcard rv d' + (index + 1) + '"><div class="dperson"><span class="dphoto-placeholder" style="display:flex">' + escapeHtml(initials(review.reviewer)) + '</span></div>' +
      '<div class="ddots" role="img" aria-label="' + rating + ' de 5 estrelas">' + '<span></span>'.repeat(rating) + '</div>' +
      '<p class="dtxt">“' + escapeHtml(review.comment) + '”</p><div class="dname">' + escapeHtml(review.reviewer || 'Cliente Itajaó') + ' · Compra verificada</div></article>';
  }
  (async function () {
    try {
      const base = String(config.functionsBaseUrl || '').replace(/\/+$/, '');
      const key = String(config.supabasePublishableKey || '');
      const response = await fetch(base + '/community-feed?type=reviews&limit=3', { headers: { apikey: key, Authorization: 'Bearer ' + key } });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar.');
      const items = Array.isArray(data.items) ? data.items : [];
      grid.innerHTML = items.length ? items.map(card).join('') : '<div class="dcard" style="grid-column:1/-1;text-align:center"><p class="dtxt">As primeiras avaliações verificadas aparecerão aqui depois da moderação.</p><div class="dname">Comunidade Itajaó</div></div>';
    } catch (error) {
      grid.innerHTML = '<div class="dcard" style="grid-column:1/-1;text-align:center"><p class="dtxt">As avaliações estão temporariamente indisponíveis.</p></div>';
    }
  })();
})();
