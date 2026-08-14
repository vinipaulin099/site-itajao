(function () {
  'use strict';

  const config = window.ITAJAO_STORE_CONFIG || {};
  const endpoint = String(config.functionsBaseUrl || '').replace(/\/+$/, '') + '/community-review';
  const key = String(config.supabasePublishableKey || '');
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const codeStep = document.getElementById('codeStep');
  const codeForm = document.getElementById('codeForm');
  const codeInput = document.getElementById('reviewCode');
  const codeHelp = document.getElementById('codeHelp');
  const verifyButton = document.getElementById('verifyButton');
  const reviewStep = document.getElementById('reviewStep');
  const reviewForm = document.getElementById('reviewForm');
  const productsToReview = document.getElementById('productsToReview');
  const reviewStatus = document.getElementById('reviewStatus');
  const reviewSubmit = document.getElementById('reviewSubmit');
  const successStep = document.getElementById('successStep');
  let verifiedCode = '';
  let availableProducts = [];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
    });
  }

  function safeImage(value) {
    try {
      const url = new URL(String(value || ''), window.location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : 'assets/images/products/500graos.png';
    } catch (error) { return 'assets/images/products/500graos.png'; }
  }

  function headers(json) {
    return Object.assign({ apikey: key, Authorization: 'Bearer ' + key }, json ? { 'Content-Type': 'application/json' } : {});
  }

  async function responseData(response) {
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }

  function productCard(product, index) {
    const itemId = escapeHtml(product.order_item_id);
    const checked = index === 0 ? ' checked' : '';
    return '<article class="product-review" data-order-item="' + itemId + '">' +
      '<div class="product-review-head"><img src="' + escapeHtml(safeImage(product.image)) + '" alt="" loading="lazy"><div><h3>' + escapeHtml(product.name) + '</h3><small>Quantidade no pedido: ' + Number(product.quantity || 1) + '</small></div></div>' +
      '<label class="review-toggle"><input class="review-enabled" type="checkbox"' + checked + '> Avaliar este produto</label>' +
      '<div class="review-fields"' + (index === 0 ? '' : ' hidden') + '>' +
        '<div class="field"><span>Nota</span><div class="stars-input" role="group" aria-label="Nota para ' + escapeHtml(product.name) + '">' +
          [1, 2, 3, 4, 5].map(function (rating) { return '<button class="star-button" type="button" data-rating="' + rating + '" aria-label="' + rating + (rating === 1 ? ' estrela' : ' estrelas') + '">★</button>'; }).join('') +
        '</div></div>' +
        '<div class="field"><label>Título <small>(opcional)</small></label><input class="review-title" maxlength="120" placeholder="Resuma sua experiência"></div>' +
        '<div class="field"><label>Comentário</label><textarea class="review-comment" maxlength="2000" rows="5" placeholder="Conte sobre aroma, sabor, preparo ou entrega" required></textarea></div>' +
        '<div class="field"><label>Foto <small>(JPG, PNG ou WebP · até 6 MB)</small></label><input class="review-photo-input" type="file" accept="image/jpeg,image/png,image/webp"></div>' +
      '</div></article>';
  }

  function bindProductCards() {
    productsToReview.querySelectorAll('.product-review').forEach(function (card) {
      const enabled = card.querySelector('.review-enabled');
      const fields = card.querySelector('.review-fields');
      enabled.addEventListener('change', function () {
        fields.hidden = !enabled.checked;
        fields.querySelector('.review-comment').required = enabled.checked;
      });
      card.querySelectorAll('.star-button').forEach(function (button) {
        button.addEventListener('click', function () {
          const rating = Number(button.getAttribute('data-rating'));
          card.dataset.rating = String(rating);
          card.querySelectorAll('.star-button').forEach(function (star) {
            const selected = Number(star.getAttribute('data-rating')) <= rating;
            star.classList.toggle('selected', selected);
            star.setAttribute('aria-pressed', String(selected));
          });
        });
      });
    });
  }

  codeInput.addEventListener('input', function () {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });

  codeForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!token) {
      codeHelp.className = 'form-status error';
      codeHelp.textContent = 'O link do convite está incompleto. Solicite um novo convite à Itajaó.';
      return;
    }
    if (!codeForm.reportValidity()) return;
    verifyButton.disabled = true;
    codeHelp.className = 'form-status';
    codeHelp.textContent = 'Confirmando seu pedido…';
    try {
      verifiedCode = codeInput.value.toUpperCase();
      const response = await fetch(endpoint, {
        method: 'POST', headers: headers(true), body: JSON.stringify({ action: 'verify', token: token, code: verifiedCode }),
      });
      const data = await responseData(response);
      availableProducts = Array.isArray(data.products) ? data.products : [];
      productsToReview.innerHTML = availableProducts.map(productCard).join('');
      bindProductCards();
      document.getElementById('orderNumber').textContent = data.order_number ? 'Pedido ' + data.order_number : 'Pedido confirmado';
      document.getElementById('firstName').value = data.customer_first_name || '';
      codeStep.hidden = true;
      reviewStep.hidden = false;
      reviewStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      codeHelp.className = 'form-status error';
      codeHelp.textContent = error.message;
    } finally {
      verifyButton.disabled = false;
    }
  });

  reviewForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!reviewForm.reportValidity()) return;
    const reviews = [];
    const uploads = [];
    let validationError = '';
    productsToReview.querySelectorAll('.product-review').forEach(function (card) {
      if (!card.querySelector('.review-enabled').checked) return;
      const product = availableProducts.find(function (item) { return item.order_item_id === card.dataset.orderItem; });
      const rating = Number(card.dataset.rating || 0);
      const comment = card.querySelector('.review-comment').value.trim();
      const file = card.querySelector('.review-photo-input').files[0];
      if (!rating && !validationError) validationError = 'Escolha uma nota para ' + (product ? product.name : 'cada produto') + '.';
      if (comment.length < 3 && !validationError) validationError = 'Conte um pouco sobre sua experiência.';
      if (file && file.size > 6 * 1024 * 1024 && !validationError) validationError = 'Cada foto pode ter no máximo 6 MB.';
      reviews.push({
        order_item_id: card.dataset.orderItem,
        rating: rating,
        title: card.querySelector('.review-title').value.trim(),
        comment: comment,
      });
      if (file) uploads.push({ name: 'photo_' + card.dataset.orderItem, file: file });
    });
    if (!reviews.length) validationError = 'Selecione pelo menos um produto para avaliar.';
    if (validationError) {
      reviewStatus.className = 'form-status error';
      reviewStatus.textContent = validationError;
      return;
    }

    const formData = new FormData();
    formData.append('token', token);
    formData.append('code', verifiedCode);
    formData.append('first_name', document.getElementById('firstName').value.trim());
    formData.append('last_name', document.getElementById('lastName').value.trim());
    formData.append('reviews', JSON.stringify(reviews));
    uploads.forEach(function (upload) { formData.append(upload.name, upload.file); });
    reviewSubmit.disabled = true;
    reviewStatus.className = 'form-status';
    reviewStatus.textContent = 'Enviando sua avaliação…';
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: headers(false), body: formData });
      await responseData(response);
      reviewStep.hidden = true;
      successStep.hidden = false;
      successStep.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      reviewStatus.className = 'form-status error';
      reviewStatus.textContent = error.message;
    } finally {
      reviewSubmit.disabled = false;
    }
  });

  if (!token) {
    codeHelp.className = 'form-status error';
    codeHelp.textContent = 'O link do convite está incompleto. Solicite um novo convite à Itajaó.';
    verifyButton.disabled = true;
  }
})();
