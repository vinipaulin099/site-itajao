(function () {
  'use strict';
  const reviewsGrid = document.getElementById('homeCommunityReviews');
  const recipesGrid = document.getElementById('homeCommunityRecipes');
  const config = window.ITAJAO_STORE_CONFIG || {};
  if (!reviewsGrid && !recipesGrid) return;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]; });
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ''), window.location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (error) { return ''; }
  }

  function initials(name) {
    return String(name || 'Cliente Itajaó').split(/\s+/).slice(0, 2).map(function (part) { return part.charAt(0); }).join('').toUpperCase();
  }

  function reviewCard(review, index) {
    const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
    return '<article class="dcard rv d' + (index + 1) + '"><div class="dperson"><span class="dphoto-placeholder" style="display:flex">' + escapeHtml(initials(review.reviewer)) + '</span></div>' +
      '<div class="ddots" role="img" aria-label="' + rating + ' de 5 estrelas">' + '<span></span>'.repeat(rating) + '</div>' +
      '<p class="dtxt">“' + escapeHtml(review.comment) + '”</p><div class="dname">' + escapeHtml(review.reviewer || 'Cliente Itajaó') + ' · Compra verificada</div></article>';
  }

  function recipeCard(recipe) {
    const photo = safeUrl(recipe.image_url);
    const facts = [
      recipe.prep_minutes ? Number(recipe.prep_minutes) + ' min' : '',
      recipe.servings ? 'Serve ' + escapeHtml(recipe.servings) : '',
    ].filter(Boolean).map(function (fact) { return '<span>' + fact + '</span>'; }).join('');
    return '<article class="home-recipe-card"><a href="comunidade.html#receitas">' +
      (photo ? '<img class="home-recipe-image" src="' + escapeHtml(photo) + '" alt="' + escapeHtml(recipe.title) + '" loading="lazy">' : '<div class="home-recipe-placeholder" aria-hidden="true">RECEITA ITAJAÓ</div>') +
      '<div class="home-recipe-body"><span class="home-recipe-author">Receita de ' + escapeHtml(recipe.author_name || 'Comunidade Itajaó') + '</span>' +
      '<h4>' + escapeHtml(recipe.title || 'Receita com Café Itajaó') + '</h4>' +
      (recipe.introduction ? '<p>' + escapeHtml(recipe.introduction) + '</p>' : '') +
      (facts ? '<div class="home-recipe-facts">' + facts + '</div>' : '') +
      '</div></a></article>';
  }

  async function request(type, limit) {
    const base = String(config.functionsBaseUrl || '').replace(/\/+$/, '');
    const key = String(config.supabasePublishableKey || '');
    const response = await fetch(base + '/community-feed?type=' + encodeURIComponent(type) + '&limit=' + limit, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'Não foi possível carregar.');
    return Array.isArray(data.items) ? data.items : [];
  }

  if (reviewsGrid) (async function () {
    try {
      const items = await request('reviews', 3);
      reviewsGrid.innerHTML = items.length ? items.map(reviewCard).join('') : '<div class="dcard" style="grid-column:1/-1;text-align:center"><p class="dtxt">As primeiras avaliações verificadas aparecerão aqui depois da moderação.</p><div class="dname">Comunidade Itajaó</div></div>';
    } catch (error) {
      reviewsGrid.innerHTML = '<div class="dcard" style="grid-column:1/-1;text-align:center"><p class="dtxt">As avaliações estão temporariamente indisponíveis.</p></div>';
    }
  })();

  if (recipesGrid) (async function () {
    try {
      const items = await request('recipes', 3);
      recipesGrid.innerHTML = items.length ? items.map(recipeCard).join('') : '<article class="home-recipe-card" style="grid-column:1/-1;text-align:center"><div class="home-recipe-body"><h4>As primeiras receitas aparecerão aqui</h4><p>Envie uma receita com Café Itajaó para a nossa equipe analisar.</p></div></article>';
    } catch (error) {
      recipesGrid.innerHTML = '<article class="home-recipe-card" style="grid-column:1/-1;text-align:center"><div class="home-recipe-body"><p>As receitas estão temporariamente indisponíveis.</p></div></article>';
    }
  })();
})();
