(function () {
  'use strict';

  var config = window.ITAJAO_STORE_CONFIG || {};
  var functionsBase = String(config.functionsBaseUrl || '').replace(/\/+$/, '');
  var publishableKey = String(config.supabasePublishableKey || '');
  var projectUrl = functionsBase.replace(/\/functions\/v1$/, '');
  var authBase = projectUrl + '/auth/v1';
  var storageKey = 'itajao_admin_community_session';
  var session = readSession();

  function byId(id) { return document.getElementById(id); }

  function readSession() {
    try {
      var value = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      return value && value.access_token ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveSession(value) {
    session = value;
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
  }

  function errorMessage(data, fallback) {
    if (!data || typeof data !== 'object') return fallback;
    return String(data.error_description || data.msg || data.message || data.error || fallback);
  }

  async function responseData(response) {
    var text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch (_) { return { error: text.slice(0, 300) }; }
  }

  async function authRequest(path, body, token) {
    var headers = { apikey: publishableKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    var response = await fetch(authBase + path, {
      method: 'POST',
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
    var data = await responseData(response);
    if (!response.ok) throw new Error(errorMessage(data, 'Não foi possível autenticar.'));
    return data;
  }

  function normalizedSession(data) {
    var value = Object.assign({}, data);
    if (!value.expires_at && value.expires_in) value.expires_at = Math.floor(Date.now() / 1000) + Number(value.expires_in);
    return value;
  }

  async function refreshSession() {
    if (!session || !session.refresh_token) throw new Error('Sua sessão expirou. Entre novamente.');
    var data = await authRequest('/token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    saveSession(normalizedSession(data));
    return session;
  }

  async function validSession() {
    if (!session) throw new Error('Faça login como administrador.');
    if (Number(session.expires_at || 0) <= Math.floor(Date.now() / 1000) + 45) await refreshSession();
    return session;
  }

  async function adminCall(payload, retry) {
    await validSession();
    var response = await fetch(functionsBase + '/community-admin', {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (response.status === 401 && retry !== false && session.refresh_token) {
      await refreshSession();
      return adminCall(payload, false);
    }
    var data = await responseData(response);
    if (!response.ok) {
      var error = new Error(errorMessage(data, 'Não foi possível concluir esta operação.'));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function setLoginStatus(message) {
    byId('loginStatus').textContent = message || '';
  }

  function setGlobalStatus(message, type) {
    var status = byId('globalStatus');
    status.textContent = message || '';
    status.className = 'notice' + (type ? ' ' + type : '');
    status.hidden = !message;
  }

  function showLogin(message) {
    byId('loginPanel').hidden = false;
    byId('dashboard').hidden = true;
    byId('sessionActions').hidden = true;
    setLoginStatus(message || '');
  }

  function showDashboard() {
    byId('loginPanel').hidden = true;
    byId('dashboard').hidden = false;
    byId('sessionActions').hidden = false;
    byId('sessionEmail').textContent = session && session.user ? String(session.user.email || '') : '';
    setLoginStatus('');
  }

  function element(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }

  function clearWithMessage(container, message) {
    container.replaceChildren(element('div', 'empty-state', message));
  }

  function formatDate(value) {
    if (!value) return 'Data não informada';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Data não informada';
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date);
  }

  function statusLabel(value) {
    var labels = { pending: 'Pendente', used: 'Utilizado', expired: 'Expirado', revoked: 'Revogado', locked: 'Bloqueado' };
    return labels[value] || 'Sem convite';
  }

  function addMeta(container, label, value) {
    var span = element('span');
    span.append(element('strong', '', label + ': '), document.createTextNode(String(value || 'Não informado')));
    container.append(span);
  }

  function renderOrders(items) {
    var container = byId('ordersList');
    byId('ordersCount').textContent = String(items.length);
    if (!items.length) {
      clearWithMessage(container, 'Nenhuma venda paga tem produtos disponíveis para avaliação.');
      return;
    }
    var fragment = document.createDocumentFragment();
    items.forEach(function (order) {
      var customer = order.customer || {};
      var latest = order.latest_invite || null;
      var card = element('article', 'admin-card');
      var head = element('div', 'card-head');
      var title = element('div');
      title.append(
        element('h3', '', 'Pedido ' + (order.external_order_number || String(order.id).slice(0, 8))),
        element('p', '', customer.full_name || 'Cliente sem nome cadastrado')
      );
      var pill = element('span', 'pill' + (latest && latest.status === 'pending' ? ' pending' : ''), latest ? statusLabel(latest.status) : 'Sem convite');
      head.append(title, pill);

      var meta = element('div', 'order-meta');
      addMeta(meta, 'Compra', formatDate(order.order_date));
      addMeta(meta, 'E-mail', customer.email || 'Não cadastrado');
      addMeta(meta, 'Telefone', customer.phone || 'Não cadastrado');
      addMeta(meta, 'Itens disponíveis', order.reviewable_items);
      if (latest) addMeta(meta, 'Último convite', formatDate(latest.created_at));
      if (latest && latest.access_code) {
        var codeMeta = element('span', 'access-code-meta');
        codeMeta.append(element('strong', '', 'Chave de acesso: '), element('code', 'order-access-code', latest.access_code));
        meta.append(codeMeta);
      }

      var actions = element('div', 'card-actions');
      var option = element('label', 'send-option');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;
      checkbox.disabled = !customer.email;
      option.append(checkbox, document.createTextNode(customer.email ? 'Enviar também por e-mail' : 'Cliente sem e-mail cadastrado'));
      var button = element('button', 'button button-primary', 'Abrir convite');
      button.type = 'button';
      button.addEventListener('click', async function () {
        var original = button.textContent;
        button.disabled = true;
        button.textContent = 'Abrindo…';
        setGlobalStatus('Preparando o acesso desta venda…');
        try {
          var result = await adminCall({ action: 'get_review_invite', order_id: order.id, send_email: checkbox.checked });
          showInvite(result);
          setGlobalStatus('Acesso pronto para compartilhar.', 'success');
          await loadOrders();
        } catch (error) {
          setGlobalStatus(error.message, 'error');
        } finally {
          button.disabled = false;
          button.textContent = original;
        }
      });
      actions.append(option, button);
      card.append(head, meta, actions);
      fragment.append(card);
    });
    container.replaceChildren(fragment);
  }

  function moderationField(box, labelText, className, placeholder) {
    var label = element('label', '', labelText);
    var textarea = element('textarea', className);
    textarea.placeholder = placeholder;
    box.append(label, textarea);
    return textarea;
  }

  function moderationActions(box, kind, id, card) {
    var actions = element('div', 'moderation-actions');
    var reject = element('button', 'button button-danger', 'Rejeitar');
    var approve = element('button', 'button button-primary', 'Aprovar');
    reject.type = approve.type = 'button';

    async function decide(status, trigger) {
      if (status === 'rejected' && !window.confirm('Rejeitar este conteúdo? Ele não será publicado.')) return;
      var buttons = [reject, approve];
      buttons.forEach(function (button) { button.disabled = true; });
      trigger.textContent = status === 'approved' ? 'Publicando…' : 'Rejeitando…';
      setGlobalStatus('Registrando a decisão…');
      try {
        await adminCall({
          action: kind === 'review' ? 'moderate_review' : 'moderate_recipe',
          id: id,
          status: status,
          admin_response: box.querySelector('.public-response').value,
          moderation_notes: box.querySelector('.internal-notes').value
        });
        setGlobalStatus(status === 'approved' ? 'Conteúdo aprovado e publicado.' : 'Conteúdo rejeitado.', 'success');
        card.remove();
        await loadPending();
      } catch (error) {
        setGlobalStatus(error.message, 'error');
        buttons.forEach(function (button) { button.disabled = false; });
        reject.textContent = 'Rejeitar';
        approve.textContent = 'Aprovar';
      }
    }

    reject.addEventListener('click', function () { decide('rejected', reject); });
    approve.addEventListener('click', function () { decide('approved', approve); });
    actions.append(reject, approve);
    box.append(actions);
  }

  function renderReviews(items) {
    var container = byId('reviewsList');
    byId('reviewsCount').textContent = String(items.length);
    if (!items.length) {
      clearWithMessage(container, 'Não há avaliações aguardando moderação.');
      return;
    }
    var fragment = document.createDocumentFragment();
    items.forEach(function (review) {
      var card = element('article', 'admin-card');
      var head = element('div', 'card-head');
      var title = element('div');
      title.append(
        element('div', 'stars', '★'.repeat(Number(review.rating || 0)) + '☆'.repeat(Math.max(0, 5 - Number(review.rating || 0)))),
        element('h3', '', review.title || 'Avaliação sem título'),
        element('p', '', (review.reviewer_first_name || 'Cliente') + ' · ' + ((review.product && review.product.name) || 'Café Itajaó'))
      );
      head.append(title, element('span', 'pill pending', 'Pendente'));

      var layout = element('div', 'review-layout');
      var content = element('div');
      var meta = element('div', 'content-meta');
      addMeta(meta, 'Recebida em', formatDate(review.created_at));
      content.append(meta, element('p', 'content-copy', review.comment || 'Sem comentário.'));
      if (review.image_url) {
        var image = element('img', 'content-photo');
        image.src = review.image_url;
        image.alt = 'Foto enviada com a avaliação';
        image.loading = 'lazy';
        content.append(image);
      }
      var moderation = element('div', 'moderation-box');
      moderationField(moderation, 'Resposta pública da Itajaó (opcional)', 'public-response', 'Aparecerá junto da avaliação aprovada.');
      moderationField(moderation, 'Nota interna (opcional)', 'internal-notes', 'Visível somente para a equipe.');
      moderationActions(moderation, 'review', review.id, card);
      layout.append(content, moderation);
      card.append(head, layout);
      fragment.append(card);
    });
    container.replaceChildren(fragment);
  }

  function listText(value) {
    if (Array.isArray(value)) return value.join('\n');
    return String(value || 'Não informado.');
  }

  function renderRecipes(items) {
    var container = byId('recipesList');
    byId('recipesCount').textContent = String(items.length);
    if (!items.length) {
      clearWithMessage(container, 'Não há receitas aguardando moderação.');
      return;
    }
    var fragment = document.createDocumentFragment();
    items.forEach(function (recipe) {
      var card = element('article', 'admin-card');
      var head = element('div', 'card-head');
      var title = element('div');
      title.append(element('h3', '', recipe.title || 'Receita sem título'), element('p', '', 'Enviada por ' + (recipe.author_name || 'Autor não informado')));
      head.append(title, element('span', 'pill wine', 'Pendente'));

      var layout = element('div', 'recipe-layout');
      var content = element('div');
      var meta = element('div', 'content-meta');
      addMeta(meta, 'Recebida em', formatDate(recipe.created_at));
      addMeta(meta, 'Preparo', recipe.prep_minutes ? recipe.prep_minutes + ' min' : 'Não informado');
      addMeta(meta, 'Rendimento', recipe.servings || 'Não informado');
      content.append(meta, element('p', 'content-copy', recipe.introduction || 'Sem introdução.'));
      var details = element('div', 'recipe-details');
      var ingredients = element('div');
      ingredients.append(element('h4', '', 'Ingredientes'), element('p', '', listText(recipe.ingredients)));
      var instructions = element('div');
      instructions.append(element('h4', '', 'Modo de preparo'), element('p', '', listText(recipe.instructions)));
      details.append(ingredients, instructions);
      content.append(details);
      if (recipe.image_url) {
        var image = element('img', 'content-photo');
        image.src = recipe.image_url;
        image.alt = 'Foto enviada com a receita';
        image.loading = 'lazy';
        content.append(image);
      }
      var moderation = element('div', 'moderation-box');
      moderationField(moderation, 'Nota pública da Itajaó (opcional)', 'public-response', 'Aparecerá junto da receita aprovada.');
      moderationField(moderation, 'Nota interna (opcional)', 'internal-notes', 'Visível somente para a equipe.');
      moderationActions(moderation, 'recipe', recipe.id, card);
      layout.append(content, moderation);
      card.append(head, layout);
      fragment.append(card);
    });
    container.replaceChildren(fragment);
  }

  function showInvite(result) {
    byId('inviteCode').textContent = String(result.code || '');
    byId('inviteMessage').value = String(result.whatsapp_message || '');
    var whatsapp = byId('whatsappInviteButton');
    whatsapp.hidden = true;
    whatsapp.removeAttribute('href');
    try {
      var url = new URL(String(result.whatsapp_url || ''));
      if (url.protocol === 'https:' && url.hostname === 'wa.me') {
        whatsapp.href = url.toString();
        whatsapp.hidden = false;
      }
    } catch (_) {}
    var productCount = Array.isArray(result.products) ? result.products.length : 0;
    byId('inviteEmailStatus').textContent = (result.email_queued ? 'O e-mail também entrou na fila de envio. ' : 'A chave permanece salva para esta venda. ') + productCount + (productCount === 1 ? ' produto disponível para avaliação.' : ' produtos disponíveis para avaliação.');
    byId('inviteDialog').showModal();
  }

  async function loadOrders() {
    var result = await adminCall({ action: 'eligible_orders' });
    renderOrders(Array.isArray(result.items) ? result.items : []);
  }

  async function loadPending() {
    var result = await adminCall({ action: 'pending' });
    renderReviews(Array.isArray(result.reviews) ? result.reviews : []);
    renderRecipes(Array.isArray(result.recipes) ? result.recipes : []);
  }

  async function refreshData() {
    var button = byId('refreshButton');
    button.disabled = true;
    setGlobalStatus('Atualizando dados da comunidade…');
    try {
      await Promise.all([loadOrders(), loadPending()]);
      setGlobalStatus('Dados atualizados.', 'success');
    } catch (error) {
      if (error.status === 401) {
        saveSession(null);
        showLogin('Sua sessão expirou. Entre novamente.');
        return;
      }
      setGlobalStatus(error.message, 'error');
      throw error;
    } finally {
      button.disabled = false;
    }
  }

  byId('loginForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!functionsBase || !publishableKey || !projectUrl) {
      setLoginStatus('A configuração pública do Supabase não foi encontrada.');
      return;
    }
    var form = event.currentTarget;
    var button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Entrando…';
    setLoginStatus('');
    try {
      var data = await authRequest('/token?grant_type=password', {
        email: String(form.elements.email.value || '').trim().toLowerCase(),
        password: String(form.elements.password.value || '')
      });
      saveSession(normalizedSession(data));
      showDashboard();
      await refreshData();
      form.elements.password.value = '';
    } catch (error) {
      saveSession(null);
      showLogin(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  });

  byId('logoutButton').addEventListener('click', async function () {
    var token = session && session.access_token;
    saveSession(null);
    showLogin('Sessão encerrada.');
    if (token) {
      try { await authRequest('/logout', null, token); } catch (_) {}
    }
  });

  byId('refreshButton').addEventListener('click', function () { refreshData().catch(function () {}); });

  document.querySelectorAll('.admin-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.admin-tab').forEach(function (value) {
        var active = value === tab;
        value.classList.toggle('active', active);
        value.setAttribute('aria-selected', String(active));
        byId(value.dataset.panel).hidden = !active;
      });
    });
  });

  byId('closeInviteDialog').addEventListener('click', function () { byId('inviteDialog').close(); });
  byId('inviteDialog').addEventListener('click', function (event) { if (event.target === event.currentTarget) event.currentTarget.close(); });
  byId('inviteDialog').addEventListener('close', function () {
    byId('inviteCode').textContent = '';
    byId('inviteMessage').value = '';
    byId('inviteEmailStatus').textContent = '';
    byId('whatsappInviteButton').hidden = true;
    byId('whatsappInviteButton').removeAttribute('href');
  });
  byId('copyInviteButton').addEventListener('click', async function (event) {
    var button = event.currentTarget;
    var value = byId('inviteMessage').value;
    try {
      await navigator.clipboard.writeText(value);
    } catch (_) {
      byId('inviteMessage').select();
      document.execCommand('copy');
    }
    button.textContent = 'Mensagem copiada';
    window.setTimeout(function () { button.textContent = 'Copiar mensagem'; }, 1800);
  });

  if (!functionsBase || !publishableKey || !projectUrl) {
    showLogin('A configuração pública do Supabase não foi encontrada.');
  } else if (session) {
    showDashboard();
    refreshData().catch(function (error) {
      if (!session) return;
      setGlobalStatus(error.message, 'error');
    });
  } else {
    showLogin();
  }
})();
