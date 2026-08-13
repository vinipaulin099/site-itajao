(function () {
  'use strict';
  var grid = document.getElementById('catalogGrid');
  var store = window.ItajaoStore;
  if (!grid || !store) return;

  var products = [
    { id: 'graos500', weight: '500g', format: 'graos', label: 'Em grãos', name: 'Itajaó Especial 500g em Grãos', copy: 'Para moer na hora e ajustar a moagem ao seu método.', image: 'assets/images/products/real/graos-500-estudio.jpg', live: true },
    { id: 'moido500', weight: '500g', format: 'moido', label: 'Moído', name: 'Itajaó Especial 500g Moído', copy: 'Pronto para o coador, com praticidade e frescor.', image: 'assets/images/products/real/moido-500-estudio.jpg', live: true },
    { weight: '1kg', format: 'graos', label: 'Em grãos', name: 'Itajaó Especial 1kg em Grãos', copy: 'Dois pacotes de 500g para preservar melhor o frescor.', image: 'assets/images/products/real/graos-1kg-kit.jpg', price: 119.90 },
    { weight: '1kg', format: 'moido', label: 'Moído', name: 'Itajaó Especial 1kg Moído', copy: 'Dois pacotes de 500g já moídos para o dia a dia.', image: 'assets/images/products/real/moido-1kg-kit.jpg', price: 119.90 },
    { weight: '3kg', format: 'graos volume', label: 'Em grãos', name: 'Kit Itajaó 3kg em Grãos', copy: 'Volume para escritórios, cafeterias e rotinas de maior consumo.', image: 'assets/images/products/real/graos-3kg-kit.jpg', price: 319.90 },
    { weight: '3kg', format: 'moido volume', label: 'Moído', name: 'Kit Itajaó 3kg Moído', copy: 'Seis pacotes de 500g com moagem prática para coador.', image: 'assets/images/products/real/moido-3kg-kit.jpg', price: 319.90 },
    { weight: '5kg', format: 'graos volume', label: 'Em grãos', name: 'Kit Itajaó 5kg em Grãos', copy: 'Composição em pacotes para manter a abertura por etapas.', image: 'assets/images/products/real/graos-3kg-kit.jpg', linePhoto: true },
    { weight: '5kg', format: 'moido volume', label: 'Moído', name: 'Kit Itajaó 5kg Moído', copy: 'Volume sob consulta, com composição adequada ao seu consumo.', image: 'assets/images/products/real/moido-3kg-kit.jpg', linePhoto: true },
    { weight: '10kg', format: 'graos volume', label: 'Em grãos', name: 'Kit Itajaó 10kg em Grãos', copy: 'Atendimento comercial para consumo recorrente e revenda.', image: 'assets/images/products/real/graos-3kg-kit.jpg', linePhoto: true },
    { weight: '10kg', format: 'moido volume', label: 'Moído', name: 'Kit Itajaó 10kg Moído', copy: 'Atendimento comercial para consumo recorrente e revenda.', image: 'assets/images/products/real/moido-3kg-kit.jpg', linePhoto: true }
  ];

  function contactUrl(product) {
    var message = 'Olá! Quero consultar preço e entrega do ' + product.name + '.';
    return 'https://wa.me/5535998087168?text=' + encodeURIComponent(message);
  }

  function card(product, liveProduct) {
    var available = Boolean(product.live && liveProduct && liveProduct.available);
    var listedPrice = Number(product.price);
    var hasListedPrice = Number.isFinite(listedPrice) && listedPrice > 0;
    var price = available ? store.money(liveProduct.price) : (hasListedPrice ? store.money(listedPrice) : 'Sob consulta');
    var priceNote = available ? 'Preço atualizado no catálogo' : (hasListedPrice ? 'Mesmo valor praticado na Shopee' : 'Confirmamos preço, estoque e entrega no atendimento');
    var actions = available
      ? '<a class="catalog-action" href="produto.html?id=' + store.escapeHtml(product.id) + '">Ver detalhes</a><button class="catalog-action primary" type="button" data-buy="' + store.escapeHtml(product.id) + '">Comprar</button>'
      : '<a class="catalog-action" href="assinatura.html">Ver assinatura</a><a class="catalog-action primary" href="' + store.escapeHtml(contactUrl(product)) + '" target="_blank" rel="noopener">Consultar</a>';
    return '<article class="catalog-card" data-catalog-card data-format="' + store.escapeHtml(product.format) + '">' +
      '<div class="catalog-photo"><img src="' + store.escapeHtml(product.image) + '" alt="' + store.escapeHtml(product.name) + '" loading="lazy"><span class="catalog-badge">' + store.escapeHtml(product.label) + '</span></div>' +
      '<div class="catalog-body"><span class="catalog-kicker">' + store.escapeHtml(product.weight) + ' · 84 pontos SCA</span><h2>' + store.escapeHtml(product.name) + '</h2><p>' + store.escapeHtml(product.copy) + (product.linePhoto ? ' Foto da linha de kits em volume.' : '') + '</p>' +
      '<div class="catalog-price">' + store.escapeHtml(price) + '<small>' + store.escapeHtml(priceNote) + '</small></div><div class="catalog-actions">' + actions + '</div></div></article>';
  }

  (async function () {
    var catalog = await store.loadCatalog();
    grid.innerHTML = products.map(function (product) { return card(product, product.id ? catalog[product.id] : null); }).join('');
    grid.querySelectorAll('[data-buy]').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = button.getAttribute('data-buy');
        if (store.add(id, 1)) window.location.href = 'carrinho.html';
      });
    });
    store.updateCounters();
  })();
})();
