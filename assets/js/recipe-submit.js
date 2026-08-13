(function () {
  'use strict';
  var config = window.ITAJAO_STORE_CONFIG || {};
  var baseUrl = String(config.functionsBaseUrl || '').replace(/\/+$/, '');
  var key = String(config.supabasePublishableKey || '');
  var form = document.getElementById('recipeForm');
  var ingredientRows = document.getElementById('ingredientRows');
  var instructionRows = document.getElementById('instructionRows');
  var status = document.getElementById('recipeStatus');
  var submit = document.getElementById('recipeSubmit');
  if (!form) return;

  function makeRow(list, type, value) {
    var row = document.createElement('div');
    row.className = 'repeat-row';
    var inputTag = type === 'Etapa' ? 'textarea' : 'input';
    var inputAttrs = type === 'Etapa' ? ' rows="2" maxlength="1200"' : ' type="text" maxlength="300"';
    row.innerHTML = '<span class="order"></span><' + inputTag + ' class="dynamic-entry"' + inputAttrs + ' aria-label="' + type + '" required></' + inputTag + '><button class="remove-row" type="button" aria-label="Remover ' + type.toLowerCase() + '">×</button>';
    row.querySelector('.dynamic-entry').value = value || '';
    row.querySelector('.remove-row').addEventListener('click', function () {
      if (list.children.length > 1) { row.remove(); renumber(list); }
    });
    list.appendChild(row);
    renumber(list);
  }

  function renumber(list) {
    Array.from(list.children).forEach(function (row, index) { row.querySelector('.order').textContent = String(index + 1); });
  }

  function values(list) {
    return Array.from(list.querySelectorAll('.dynamic-entry')).map(function (input) { return input.value.trim(); }).filter(Boolean);
  }

  document.getElementById('addIngredient').addEventListener('click', function () { makeRow(ingredientRows, 'Ingrediente'); ingredientRows.lastElementChild.querySelector('.dynamic-entry').focus(); });
  document.getElementById('addInstruction').addEventListener('click', function () { makeRow(instructionRows, 'Etapa'); instructionRows.lastElementChild.querySelector('.dynamic-entry').focus(); });
  makeRow(ingredientRows, 'Ingrediente', '20g de Café Itajaó');
  makeRow(ingredientRows, 'Ingrediente');
  makeRow(instructionRows, 'Etapa');
  makeRow(instructionRows, 'Etapa');

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var ingredients = values(ingredientRows);
    var instructions = values(instructionRows);
    document.getElementById('recipeIngredients').value = ingredients.join('\n');
    document.getElementById('recipeInstructions').value = instructions.map(function (step, index) { return (index + 1) + '. ' + step; }).join('\n');
    if (!ingredients.length || !instructions.length || !form.reportValidity()) return;
    var file = document.getElementById('recipePhoto').files[0];
    if (file && file.size > 6 * 1024 * 1024) { status.textContent = 'A foto pode ter no máximo 6 MB.'; return; }
    submit.disabled = true; status.textContent = 'Enviando sua receita...';
    try {
      if (!baseUrl || !key) throw new Error('O envio está indisponível no momento.');
      var response = await fetch(baseUrl + '/community-recipe', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key }, body: new FormData(form) });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'Não foi possível enviar a receita.');
      form.reset(); ingredientRows.innerHTML = ''; instructionRows.innerHTML = ''; makeRow(ingredientRows, 'Ingrediente', '20g de Café Itajaó'); makeRow(ingredientRows, 'Ingrediente'); makeRow(instructionRows, 'Etapa'); makeRow(instructionRows, 'Etapa');
      status.textContent = 'Receita recebida. Você receberá um e-mail quando a análise for concluída.';
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  });
})();
