(function () {
  'use strict';

  const config = window.ITAJAO_STORE_CONFIG || {};
  const functionsBaseUrl = String(config.functionsBaseUrl || '').replace(/\/+$/, '');
  const publishableKey = String(config.supabasePublishableKey || '');
  const reviewsGrid = document.getElementById('reviewsGrid');
  const recipesGrid = document.getElementById('recipesGrid');
  const reviewSummary = document.getElementById('reviewSummary');
  const averageRating = document.getElementById('averageRating');
  const reviewCount = document.getElementById('reviewCount');
  const ratingFilters = document.getElementById('ratingFilters');
  const loadMoreReviews = document.getElementById('loadMoreReviews');
  const loadMoreRecipes = document.getElementById('loadMoreRecipes');
  const recipeDialog = document.getElementById('recipeDialog');
  const recipeForm = document.getElementById('recipeForm');
  const recipeStatus = document.getElementById('recipeStatus');
  const recipeSubmit = document.getElementById('recipeSubmit');
  const state = { reviewsPage: 1, recipesPage: 1, rating: 0, reviewsLoading: false, recipesLoading: false };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
    });
  }

  function safeUrl(value, fallback) {
    try {
      const url = new URL(String(value || ''), window.location.href);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch (error) { /* URL inválida. */ }
    return fallback || '';
  }

  function requestHeaders() {
    return {
      apikey: publishableKey,
      Authorization: 'Bearer ' + publishableKey,
    };
  }

  async function request(path, options) {
    if (!functionsBaseUrl || !publishableKey) throw new Error('Configuração do site indisponível.');
    const init = options || {};
    init.headers = Object.assign({}, requestHeaders(), init.headers || {});
    const response = await fetch(functionsBaseUrl + '/' + path, init);
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }

  function stars(rating) {
    const value = Math.max(0, Math.min(5, Number(rating) || 0));
    return '★'.repeat(value) + '☆'.repeat(5 - value);
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' }).format(date);
  }

  function reviewCard(review) {
    const product = review.product || {};
    const productName = escapeHtml(product.name || 'Café Itajaó');
    const productKey = encodeURIComponent(String(product.store_key || ''));
    const productLabel = productKey
      ? '<a href="produto.html?id=' + productKey + '">' + productName + '</a>'
      : productName;
    const photo = safeUrl(review.image_url, '');
    const title = review.title ? '<h3>' + escapeHtml(review.title) + '</h3>' : '';
    const response = review.admin_response
      ? '<div class="brand-response"><strong>Resposta da Itajaó</strong>' + escapeHtml(review.admin_response) + '</div>'
      : '';
    return '<article class="review-card">' +
      '<span class="stars" role="img" aria-label="' + Number(review.rating) + ' de 5 estrelas">' + stars(review.rating) + '</span>' +
      '<div class="review-product">' + productLabel + '</div>' +
      title +
      '<p>' + escapeHtml(review.comment) + '</p>' +
      (photo ? '<img class="review-photo" src="' + escapeHtml(photo) + '" alt="Foto enviada na avaliação" loading="lazy">' : '') +
      response +
      '<div class="review-meta"><span>' + escapeHtml(review.reviewer || 'Cliente Itajaó') + '</span>' +
      '<span class="verified">✓ Compra verificada</span><span>' + escapeHtml(formatDate(review.published_at)) + '</span></div>' +
      '</article>';
  }

  function updateRatingSummary(data) {
    const distribution = data.distribution || {};
    const total = [1, 2, 3, 4, 5].reduce(function (sum, rating) {
      return sum + (Number(distribution[String(rating)]) || 0);
    }, 0);
    reviewSummary.hidden = total === 0;
    if (!total) return;
    averageRating.textContent = Number(data.average || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    reviewCount.textContent = total === 1 ? '1 avaliação verificada' : total + ' avaliações verificadas';
    ratingFilters.innerHTML = [0, 5, 4, 3, 2, 1].map(function (rating) {
      const count = rating === 0 ? total : (Number(distribution[String(rating)]) || 0);
      const width = total ? Math.round((count / total) * 100) : 0;
      const label = rating === 0 ? 'Todas' : rating + ' estrelas';
      return '<button class="rating-filter' + (state.rating === rating ? ' active' : '') + '" type="button" data-rating="' + rating + '">' +
        '<span>' + label + '</span><span class="rating-track"><span class="rating-fill" style="width:' + width + '%"></span></span><span>' + count + '</span></button>';
    }).join('');
    ratingFilters.querySelectorAll('[data-rating]').forEach(function (button) {
      button.addEventListener('click', function () {
        const nextRating = Number(button.getAttribute('data-rating')) || 0;
        if (state.rating === nextRating) return;
        state.rating = nextRating;
        loadReviews(true);
      });
    });
  }

  async function loadReviews(reset) {
    if (state.reviewsLoading) return;
    state.reviewsLoading = true;
    if (reset) {
      state.reviewsPage = 1;
      reviewsGrid.innerHTML = '<div class="loading-state">Carregando avaliações…</div>';
    }
    loadMoreReviews.disabled = true;
    try {
      const query = new URLSearchParams({ type: 'reviews', page: String(state.reviewsPage), limit: '12' });
      if (state.rating) query.set('rating', String(state.rating));
      const data = await request('community-feed?' + query.toString());
      const items = Array.isArray(data.items) ? data.items : [];
      if (reset) reviewsGrid.innerHTML = '';
      reviewsGrid.insertAdjacentHTML('beforeend', items.map(reviewCard).join(''));
      if (!reviewsGrid.children.length) {
        reviewsGrid.innerHTML = '<div class="empty-state">Ainda não há avaliações' + (state.rating ? ' com essa nota' : '') + '. As primeiras experiências aparecerão aqui depois da moderação.</div>';
      }
      updateRatingSummary(data);
      loadMoreReviews.hidden = state.reviewsPage * Number(data.limit || 12) >= Number(data.total || 0);
    } catch (error) {
      if (reset) reviewsGrid.innerHTML = '<div class="empty-state">' + escapeHtml(error.message) + '</div>';
    } finally {
      state.reviewsLoading = false;
      loadMoreReviews.disabled = false;
    }
  }

  function recipeCard(recipe) {
    const photo = safeUrl(recipe.image_url, '');
    const facts = [
      recipe.prep_minutes ? '⏱ ' + Number(recipe.prep_minutes) + ' min' : '',
      recipe.servings ? 'Serve ' + escapeHtml(recipe.servings) : '',
    ].filter(Boolean).map(function (fact) { return '<span>' + fact + '</span>'; }).join('');
    return '<article class="recipe-card">' +
      (photo ? '<img src="' + escapeHtml(photo) + '" alt="' + escapeHtml(recipe.title) + '" loading="lazy">' : '<div class="recipe-placeholder" aria-hidden="true">☕</div>') +
      '<div class="recipe-body"><span class="recipe-author">Receita de ' + escapeHtml(recipe.author_name) + '</span>' +
      '<h3>' + escapeHtml(recipe.title) + '</h3>' +
      (recipe.introduction ? '<p>' + escapeHtml(recipe.introduction) + '</p>' : '') +
      (facts ? '<div class="recipe-facts">' + facts + '</div>' : '') +
      '<details><summary>Ver receita completa</summary><div class="recipe-content"><h4>Ingredientes</h4><p>' + escapeHtml(recipe.ingredients) + '</p><h4>Modo de preparo</h4><p>' + escapeHtml(recipe.instructions) + '</p>' +
      (recipe.admin_response ? '<div class="brand-response"><strong>Nota da Itajaó</strong>' + escapeHtml(recipe.admin_response) + '</div>' : '') +
      '</div></details></div></article>';
  }

  async function loadRecipes(reset) {
    if (state.recipesLoading) return;
    state.recipesLoading = true;
    if (reset) {
      state.recipesPage = 1;
      recipesGrid.innerHTML = '<div class="loading-state">Carregando receitas…</div>';
    }
    loadMoreRecipes.disabled = true;
    try {
      const data = await request('community-feed?type=recipes&page=' + state.recipesPage + '&limit=9');
      const items = Array.isArray(data.items) ? data.items : [];
      if (reset) recipesGrid.innerHTML = '';
      recipesGrid.insertAdjacentHTML('beforeend', items.map(recipeCard).join(''));
      if (!recipesGrid.children.length) recipesGrid.innerHTML = '<div class="empty-state">Ainda não há receitas publicadas. Envie a primeira para nossa equipe analisar.</div>';
      loadMoreRecipes.hidden = state.recipesPage * Number(data.limit || 9) >= Number(data.total || 0);
    } catch (error) {
      if (reset) recipesGrid.innerHTML = '<div class="empty-state">' + escapeHtml(error.message) + '</div>';
    } finally {
      state.recipesLoading = false;
      loadMoreRecipes.disabled = false;
    }
  }

  function activateTab(name, updateHash) {
    const isRecipes = name === 'recipes';
    document.getElementById('reviewsPanel').hidden = isRecipes;
    document.getElementById('recipesPanel').hidden = !isRecipes;
    document.getElementById('reviewsTab').classList.toggle('active', !isRecipes);
    document.getElementById('recipesTab').classList.toggle('active', isRecipes);
    document.getElementById('reviewsTab').setAttribute('aria-selected', String(!isRecipes));
    document.getElementById('recipesTab').setAttribute('aria-selected', String(isRecipes));
    if (updateHash) history.replaceState(null, '', isRecipes ? '#receitas' : '#avaliacoes');
    if (isRecipes && state.recipesPage === 1 && recipesGrid.querySelector('.loading-state')) loadRecipes(true);
  }

  function openRecipe() {
    activateTab('recipes', true);
    if (typeof recipeDialog.showModal === 'function') recipeDialog.showModal();
    else recipeDialog.setAttribute('open', '');
  }

  function closeRecipe() {
    if (typeof recipeDialog.close === 'function') recipeDialog.close();
    else recipeDialog.removeAttribute('open');
  }

  document.querySelectorAll('[data-tab]').forEach(function (button) {
    button.addEventListener('click', function () { activateTab(button.getAttribute('data-tab'), true); });
  });
  document.querySelectorAll('[data-open-recipe]').forEach(function (button) { button.addEventListener('click', openRecipe); });
  document.querySelectorAll('[data-close-recipe]').forEach(function (button) { button.addEventListener('click', closeRecipe); });
  recipeDialog.addEventListener('click', function (event) { if (event.target === recipeDialog) closeRecipe(); });
  loadMoreReviews.addEventListener('click', function () { state.reviewsPage += 1; loadReviews(false); });
  loadMoreRecipes.addEventListener('click', function () { state.recipesPage += 1; loadRecipes(false); });

  recipeForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!recipeForm.reportValidity()) return;
    const file = document.getElementById('recipePhoto').files[0];
    if (file && file.size > 6 * 1024 * 1024) {
      recipeStatus.className = 'form-status error';
      recipeStatus.textContent = 'A foto pode ter no máximo 6 MB.';
      return;
    }
    recipeSubmit.disabled = true;
    recipeStatus.className = 'form-status';
    recipeStatus.textContent = 'Enviando sua receita…';
    try {
      await request('community-recipe', { method: 'POST', body: new FormData(recipeForm) });
      recipeForm.reset();
      recipeStatus.className = 'form-status success';
      recipeStatus.textContent = 'Receita recebida! Você receberá um e-mail quando nossa equipe concluir a análise.';
    } catch (error) {
      recipeStatus.className = 'form-status error';
      recipeStatus.textContent = error.message;
    } finally {
      recipeSubmit.disabled = false;
    }
  });

  const initialTab = window.location.hash === '#receitas' ? 'recipes' : 'reviews';
  activateTab(initialTab, false);
  loadReviews(true);
  if (initialTab === 'recipes') loadRecipes(true);
})();
