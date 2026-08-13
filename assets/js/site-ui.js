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

  document.querySelectorAll('[data-current-year]').forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });
  setupFaq();
  setupCatalogFilters();
  setupNavShadow();
  if (window.ItajaoStore) window.ItajaoStore.updateCounters();
})();
