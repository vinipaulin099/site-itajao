(function () {
  'use strict';

  function setupFaq() {
    document.querySelectorAll('.faq-question').forEach(function (button) {
      button.addEventListener('click', function () {
        var item = button.closest('.faq-item');
        if (!item) return;
        var willOpen = !item.classList.contains('open');
        item.parentElement.querySelectorAll('.faq-item.open').forEach(function (openItem) {
          openItem.classList.remove('open');
          var openButton = openItem.querySelector('.faq-question');
          if (openButton) openButton.setAttribute('aria-expanded', 'false');
        });
        item.classList.toggle('open', willOpen);
        button.setAttribute('aria-expanded', String(willOpen));
      });
    });
  }

  function setupCatalogFilters() {
    var buttons = document.querySelectorAll('[data-catalog-filter]');
    if (!buttons.length) return;
    var cards = document.querySelectorAll('[data-catalog-card]');
    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var filter = button.getAttribute('data-catalog-filter') || 'todos';
        buttons.forEach(function (candidate) {
          var active = candidate === button;
          candidate.classList.toggle('active', active);
          candidate.setAttribute('aria-pressed', String(active));
        });
        cards.forEach(function (card) {
          var formats = String(card.getAttribute('data-format') || '').split(' ');
          card.hidden = filter !== 'todos' && formats.indexOf(filter) === -1;
        });
      });
    });
  }

  function setupNavShadow() {
    var nav = document.querySelector('.global-nav');
    if (!nav) return;
    function paint() {
      nav.style.boxShadow = window.scrollY > 40 ? '0 12px 34px rgba(24,38,31,.09)' : '0 8px 28px rgba(24,38,31,.035)';
    }
    paint();
    window.addEventListener('scroll', paint, { passive: true });
  }

  function setupMobileNav() {
    document.querySelectorAll('.global-nav').forEach(function (nav, index) {
      var menu = nav.querySelector('.nav-links, .site-links');
      var actions = nav.querySelector('.nav-actions');
      if (!menu || !actions || actions.querySelector('.mobile-menu-toggle')) return;

      if (!menu.id) menu.id = 'mobileNavMenu' + (index ? '-' + index : '');
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'mobile-menu-toggle';
      toggle.setAttribute('aria-label', 'Abrir menu');
      toggle.setAttribute('aria-controls', menu.id);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span></span><span></span><span></span>';
      actions.appendChild(toggle);

      function closeMenu() {
        nav.classList.remove('mobile-nav-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Abrir menu');
      }

      toggle.addEventListener('click', function () {
        var willOpen = !nav.classList.contains('mobile-nav-open');
        nav.classList.toggle('mobile-nav-open', willOpen);
        toggle.setAttribute('aria-expanded', String(willOpen));
        toggle.setAttribute('aria-label', willOpen ? 'Fechar menu' : 'Abrir menu');
      });
      menu.querySelectorAll('a').forEach(function (link) {
        link.addEventListener('click', closeMenu);
      });
      document.addEventListener('click', function (event) {
        if (nav.classList.contains('mobile-nav-open') && !nav.contains(event.target)) closeMenu();
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && nav.classList.contains('mobile-nav-open')) {
          closeMenu();
          toggle.focus();
        }
      });
      window.addEventListener('resize', function () {
        if (window.innerWidth > 600) closeMenu();
      });
    });
  }

  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
    return new Promise(function (resolve, reject) {
      var field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try {
        if (!document.execCommand('copy')) throw new Error('copy-not-supported');
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        field.remove();
      }
    });
  }

  function setupCouponCopy() {
    document.querySelectorAll('[data-copy-coupon]').forEach(function (button) {
      var code = String(button.getAttribute('data-copy-coupon') || '').trim().toUpperCase();
      var hint = button.querySelector('.coupon-copy-hint');
      if (!code || !hint) return;
      var originalHint = hint.textContent;
      var resetTimer;

      button.addEventListener('click', function () {
        clearTimeout(resetTimer);
        copyText(code).then(function () {
          button.classList.add('copied');
          button.setAttribute('aria-label', 'Cupom ' + code + ' copiado');
          hint.textContent = 'Cupom copiado!';
        }).catch(function () {
          button.classList.remove('copied');
          button.setAttribute('aria-label', 'Copiar cupom ' + code);
          hint.textContent = 'Não foi possível copiar';
        }).finally(function () {
          resetTimer = window.setTimeout(function () {
            button.classList.remove('copied');
            button.setAttribute('aria-label', 'Copiar cupom ' + code);
            hint.textContent = originalHint;
          }, 2200);
        });
      });
    });
  }

  document.querySelectorAll('[data-current-year]').forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });
  setupFaq();
  setupCatalogFilters();
  setupMobileNav();
  setupCouponCopy();
  setupNavShadow();
  if (window.ItajaoStore) window.ItajaoStore.updateCounters();
})();
