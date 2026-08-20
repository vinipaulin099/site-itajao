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
    var weight = selected('weight');
    var format = selected('format');
    var billing = selected('billing');
    document.getElementById('summaryWeight').textContent = weight;
    document.getElementById('summaryFormat').textContent = format;
    document.getElementById('summaryBilling').textContent = billing;
    var message = 'Olá! Quero confirmar uma assinatura Itajaó de ' + weight + ', ' + format.toLowerCase() + ', pagamento ' + billing.toLowerCase() + '.';
    contact.href = 'https://wa.me/5535998087168?text=' + encodeURIComponent(message);
  }

  form.addEventListener('change', update);
  update();
})();
