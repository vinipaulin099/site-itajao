(function () {
  'use strict';
  var form = document.getElementById('subscriptionForm');
  if (!form) return;
  var contact = document.getElementById('subscriptionContact');

  function selected(name) {
    var field = form.querySelector('[name="' + name + '"]:checked');
    return field ? field.value : '';
  }

  function update() {
    var packages = Number(selected('packages')) || 1;
    var weight = selected('weight');
    var format = selected('format');
    var billing = selected('billing');
    var grams = weight === '1kg' ? 1000 : 500;
    var totalGrams = grams * packages;
    var totalLabel = totalGrams >= 1000 ? String(totalGrams / 1000).replace('.', ',') + 'kg' : totalGrams + 'g';
    document.getElementById('summaryPackages').textContent = packages + (packages === 1 ? ' pacote' : ' pacotes');
    document.getElementById('summaryWeight').textContent = weight;
    document.getElementById('summaryFormat').textContent = format;
    document.getElementById('summaryBilling').textContent = billing;
    document.getElementById('summaryTotalWeight').textContent = totalLabel;
    var message = 'Olá! Quero confirmar uma assinatura Itajaó: ' + packages + (packages === 1 ? ' pacote' : ' pacotes') + ' de ' + weight + ', ' + format.toLowerCase() + ', pagamento ' + billing.toLowerCase() + '.';
    contact.href = 'https://wa.me/5535998087168?text=' + encodeURIComponent(message);
  }

  form.addEventListener('change', update);
  update();
})();
