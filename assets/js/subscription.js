(function(root){
  'use strict';

  function calculate(config,planKey,weight,billing){
    var plan=config&&config.plans&&config.plans[planKey];
    if(!plan)throw new Error('Plano de assinatura inválido.');
    var unitPriceCents=Number(plan.pricesCents&&plan.pricesCents[weight]);
    if(!Number.isInteger(unitPriceCents)||unitPriceCents<1)throw new Error('Preço da assinatura inválido.');
    if(billing!=='standard'&&billing!=='pix')throw new Error('Forma de pagamento inválida.');

    var originalTotalCents=unitPriceCents*Number(plan.pricePeriods||1);
    var discountRate=billing==='pix'?Number(config.pixDiscountRate||0):0;
    var finalTotalCents=billing==='pix'?Math.round(originalTotalCents*(1-discountRate)):originalTotalCents;
    var discountCents=originalTotalCents-finalTotalCents;

    return {
      planKey:planKey,
      planLabel:plan.label,
      weight:weight,
      billing:billing,
      unitPriceCents:unitPriceCents,
      originalTotalCents:originalTotalCents,
      discountCents:discountCents,
      finalTotalCents:finalTotalCents,
      discountRate:discountRate,
      shipments:Number(plan.shipments||1),
      pricePeriods:Number(plan.pricePeriods||1),
      standardPayments:Number(plan.standardPayments||1),
      durationLabel:plan.durationLabel,
      freeShipping:Boolean(config.freeShipping),
      shippingAmountCents:0,
      couponEligible:Boolean(config.couponEligible)
    };
  }

  root.ItajaoSubscriptionPricing=Object.freeze({calculate:calculate});
  if(!root.document)return;

  var document=root.document;
  var config=root.ITAJAO_SUBSCRIPTION_CONFIG;
  var form=document.getElementById('subscriptionForm');
  if(!config||!form)return;

  var nodes={
    monthlyPlanPrice:document.getElementById('monthlyPlanPrice'),
    annualPlanPrice:document.getElementById('annualPlanPrice'),
    standardBillingTitle:document.getElementById('standardBillingTitle'),
    standardBillingCopy:document.getElementById('standardBillingCopy'),
    pixBillingCopy:document.getElementById('pixBillingCopy'),
    summaryPlan:document.getElementById('summaryPlan'),
    summaryWeight:document.getElementById('summaryWeight'),
    summaryFormat:document.getElementById('summaryFormat'),
    summaryDuration:document.getElementById('summaryDuration'),
    summaryShipments:document.getElementById('summaryShipments'),
    summaryBilling:document.getElementById('summaryBilling'),
    standardPricePanel:document.getElementById('standardPricePanel'),
    standardPriceLabel:document.getElementById('standardPriceLabel'),
    standardPriceMain:document.getElementById('standardPriceMain'),
    standardPriceTotal:document.getElementById('standardPriceTotal'),
    pixPricePanel:document.getElementById('pixPricePanel'),
    pixOriginalPrice:document.getElementById('pixOriginalPrice'),
    pixDiscountValue:document.getElementById('pixDiscountValue'),
    pixFinalPrice:document.getElementById('pixFinalPrice'),
    pixSavings:document.getElementById('pixSavings'),
    subscriptionNote:document.getElementById('subscriptionNote'),
    subscriptionCta:document.getElementById('subscriptionCta'),
    subscriptionStatus:document.getElementById('subscriptionStatus')
  };

  function money(cents){
    if(root.ItajaoStore&&typeof root.ItajaoStore.money==='function')return root.ItajaoStore.money(cents/100);
    return new Intl.NumberFormat('pt-BR',{style:'currency',currency:config.currency||'BRL'}).format(cents/100);
  }

  function checked(name){
    var input=form.querySelector('input[name="'+name+'"]:checked');
    return input&&input.value;
  }

  function selection(){
    return {
      planKey:checked('plan')||'monthly',
      weight:checked('weight')||'500g',
      format:checked('format')||'Em grãos',
      billing:checked('billing')||'standard'
    };
  }

  function paymentLabel(planKey,billing){
    if(planKey==='annual')return billing==='pix'?'PIX anual à vista — 5% OFF':'12 cobranças mensais';
    return billing==='pix'?'PIX do mês — 5% OFF':'1 cobrança mensal';
  }

  function updatePlanPrices(weight){
    var monthly=config.plans.monthly.pricesCents[weight];
    var annual=config.plans.annual.pricesCents[weight];
    nodes.monthlyPlanPrice.innerHTML=money(monthly)+' <small>/mês</small>';
    nodes.annualPlanPrice.textContent='12x de '+money(annual);
  }

  function updatePaymentCards(planKey){
    if(planKey==='annual'){
      nodes.standardBillingTitle.textContent='12 pagamentos mensais';
      nodes.standardBillingCopy.textContent='Uma cobrança por mês durante os 12 meses do plano.';
      nodes.pixBillingCopy.textContent='Pagamento antecipado dos 12 meses com 5% de desconto.';
      return;
    }
    nodes.standardBillingTitle.textContent='Pagamento mensal';
    nodes.standardBillingCopy.textContent='Uma cobrança por ciclo, com renovação mensal.';
    nodes.pixBillingCopy.textContent='Pagamento de um mês com 5% de desconto; renove no próximo ciclo.';
  }

  function buildCheckoutPayload(state,price){
    return {
      version:config.version,
      type:'itajao_subscription',
      plan:state.planKey,
      weight:state.weight,
      format:state.format,
      billing:state.billing,
      shipments:price.shipments,
      pricePeriods:price.pricePeriods,
      unitPriceCents:price.unitPriceCents,
      originalTotalCents:price.originalTotalCents,
      discountRate:price.discountRate,
      discountCents:price.discountCents,
      totalCents:price.finalTotalCents,
      freeShipping:true,
      shippingAmountCents:0,
      couponEligible:false
    };
  }

  function render(){
    var state=selection();
    var price=calculate(config,state.planKey,state.weight,state.billing);
    var isAnnual=state.planKey==='annual';
    var isPix=state.billing==='pix';

    updatePlanPrices(state.weight);
    updatePaymentCards(state.planKey);
    nodes.summaryPlan.textContent=price.planLabel;
    nodes.summaryWeight.textContent=state.weight;
    nodes.summaryFormat.textContent=state.format;
    nodes.summaryDuration.textContent=price.durationLabel;
    nodes.summaryShipments.textContent=isAnnual?'12 envios':'1 envio por ciclo';
    nodes.summaryBilling.textContent=paymentLabel(state.planKey,state.billing);
    nodes.standardPricePanel.hidden=isPix;
    nodes.pixPricePanel.hidden=!isPix;

    if(!isPix){
      nodes.standardPriceLabel.textContent=isAnnual?'Pagamento mensal':'Valor por ciclo';
      nodes.standardPriceMain.textContent=isAnnual?'12x de '+money(price.unitPriceCents):money(price.unitPriceCents)+' / mês';
      nodes.standardPriceTotal.textContent=isAnnual?'Total da assinatura: '+money(price.originalTotalCents):'Renovação mensal';
    }else{
      nodes.pixOriginalPrice.textContent=money(price.originalTotalCents);
      nodes.pixDiscountValue.textContent='− '+money(price.discountCents);
      nodes.pixFinalPrice.textContent=money(price.finalTotalCents);
      nodes.pixSavings.textContent='Economize '+money(price.discountCents)+' pagando pelo PIX';
    }

    if(isAnnual){
      nodes.subscriptionNote.textContent=isPix?'Você receberá 12 cafés ao longo do ano, sempre com frete grátis. Pagamento antecipado dos 12 meses com 5% de desconto.':'Você receberá 12 cafés ao longo do ano, sempre com frete grátis. Pagamento dividido em 12 cobranças mensais.';
      nodes.subscriptionCta.textContent=isPix?'ASSINAR ANUAL NO PIX':'ASSINAR PLANO ANUAL';
    }else{
      nodes.subscriptionNote.textContent=isPix?'Você receberá 1 café neste ciclo, com frete grátis. Pagamento de um mês no PIX com 5% de desconto.':'Você receberá 1 café por ciclo, sempre com frete grátis. Pagamento com renovação mensal.';
      nodes.subscriptionCta.textContent=isPix?'ASSINAR MENSAL NO PIX':'ASSINAR PLANO MENSAL';
    }

    form.dataset.checkoutPayload=JSON.stringify(buildCheckoutPayload(state,price));
    nodes.subscriptionStatus.textContent=config.checkout&&config.checkout.enabled?'Contratação segura pelo site. Cupons não se aplicam à assinatura.':'A contratação online será ativada nesta página.';
    nodes.subscriptionStatus.classList.remove('is-error');
  }

  form.addEventListener('change',render);
  form.addEventListener('submit',function(event){
    event.preventDefault();
    var payload=JSON.parse(form.dataset.checkoutPayload||'{}');
    try{root.sessionStorage.setItem('itajaoSubscriptionCheckout',JSON.stringify(payload));}catch(_){/* O checkout recebe o payload diretamente quando estiver ativo. */}
    if(config.checkout&&config.checkout.enabled&&config.checkout.url){
      root.location.assign(config.checkout.url);
      return;
    }
    nodes.subscriptionStatus.textContent='O checkout exclusivo da assinatura ainda não está ativo. Sua seleção foi preservada.';
    nodes.subscriptionStatus.classList.add('is-error');
  });

  render();
})(typeof window!=='undefined'?window:globalThis);
