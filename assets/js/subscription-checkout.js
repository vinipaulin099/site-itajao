(function(){
  'use strict';

  const config=window.ITAJAO_SUBSCRIPTION_CONFIG||{};
  const pricing=window.ItajaoSubscriptionPricing;
  const store=window.ItajaoStore;
  const $=id=>document.getElementById(id);
  let selection=null;
  let price=null;
  let statusTimer=null;

  function setMessage(message,type){
    $('checkoutMessage').textContent=message||'';
    $('checkoutMessage').className='club-message'+(type?' '+type:'');
  }

  function money(cents){
    return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100);
  }

  function readSelection(){
    let value=null;
    try{value=JSON.parse(sessionStorage.getItem('itajaoSubscriptionCheckout')||'null')}catch(_){return null}
    if(!value||value.type!=='itajao_subscription')return null;
    if(!['monthly','annual'].includes(value.plan))return null;
    if(!['500g','1kg'].includes(value.weight))return null;
    if(!['Em grãos','Moído'].includes(value.format))return null;
    if(!['standard','pix'].includes(value.billing))return null;
    return {plan:value.plan,weight:value.weight,format:value.format,billing:value.billing};
  }

  function planLabel(){return selection.plan==='annual'?'Plano anual':'Plano mensal'}
  function weightLabel(){return selection.weight==='1kg'?'1kg':'500g'}
  function billingLabel(){
    if(selection.billing==='pix')return selection.plan==='annual'?'PIX anual à vista · 5% OFF':'PIX do mês · 5% OFF';
    return selection.plan==='annual'?'12 cobranças mensais':'Renovação mensal';
  }

  function render(){
    price=pricing.calculate(config,selection.plan,selection.weight,selection.billing);
    const annual=selection.plan==='annual';
    const pix=selection.billing==='pix';
    $('checkoutPlan').textContent=planLabel();
    $('checkoutCoffee').textContent=weightLabel()+' · '+selection.format;
    $('checkoutBilling').textContent=billingLabel();
    $('summaryPlan').textContent=planLabel();
    $('summaryWeight').textContent=weightLabel()+' por envio';
    $('summaryFormat').textContent=selection.format;
    $('summaryShipments').textContent=annual?'12 envios':'1 envio por ciclo';
    $('summaryPayment').textContent=billingLabel();

    $('priceOriginalRow').hidden=!pix;
    $('priceDiscountRow').hidden=!pix;
    if(pix){
      $('priceLabel').textContent=annual?'Total anual no PIX':'Total do mês no PIX';
      $('priceMain').textContent=money(price.finalTotalCents);
      $('priceSupport').textContent=annual?'12 envios pagos antecipadamente':'1 envio; renove no próximo ciclo';
      $('priceOriginal').textContent=money(price.originalTotalCents);
      $('priceDiscount').textContent='− '+money(price.discountCents)+' · 5% OFF';
    }else if(annual){
      $('priceLabel').textContent='Pagamento mensal';
      $('priceMain').textContent='12x de '+money(price.unitPriceCents);
      $('priceSupport').textContent='Total contratado: '+money(price.originalTotalCents);
    }else{
      $('priceLabel').textContent='Valor mensal';
      $('priceMain').textContent=money(price.unitPriceCents);
      $('priceSupport').textContent='Renovação mensal';
    }

    const enabled=Boolean(config.checkout&&config.checkout.enabled);
    $('subscriptionPayButton').disabled=!enabled;
    $('subscriptionSetupNote').hidden=enabled;
    if(!enabled)setMessage('A contratação pública continua protegida enquanto concluímos os testes reais.','info');
  }

  function requestId(){
    const fingerprint=[selection.plan,selection.weight,selection.format,selection.billing].join('|');
    const key='itajaoSubscriptionRequestV1';
    try{
      const previous=JSON.parse(sessionStorage.getItem(key)||'null');
      if(previous&&previous.fingerprint===fingerprint&&previous.id)return previous.id;
      const id=crypto.randomUUID();
      sessionStorage.setItem(key,JSON.stringify({fingerprint,id,createdAt:Date.now()}));
      return id;
    }catch(_){return crypto.randomUUID()}
  }

  function customerPayload(){
    return {
      name:$('fullName').value.trim(),
      email:$('email').value.trim().toLowerCase(),
      phone:store.digits($('phone').value),
      document:store.digits($('document').value)
    };
  }

  function addressPayload(){
    return {
      postalCode:store.digits($('postalCode').value),
      street:$('street').value.trim(),
      number:$('number').value.trim(),
      complement:$('complement').value.trim(),
      district:$('district').value.trim(),
      city:$('city').value.trim(),
      state:$('state').value.trim().toUpperCase()
    };
  }

  async function fillAddressFromCep(){
    const cep=store.digits($('postalCode').value);
    if(cep.length!==8)return;
    $('postalCode').value=cep.slice(0,5)+'-'+cep.slice(5);
    try{
      const response=await fetch('https://viacep.com.br/ws/'+cep+'/json/');
      if(!response.ok)return;
      const data=await response.json();
      if(data.erro)return;
      if(data.logradouro)$('street').value=data.logradouro;
      if(data.bairro)$('district').value=data.bairro;
      if(data.localidade)$('city').value=data.localidade;
      if(data.uf)$('state').value=data.uf;
      $('number').focus();
    }catch(_){}
  }

  function statusUrl(data){
    if(data.statusUrl)return data.statusUrl;
    const url=new URL('assinatura-status.html',location.href);
    url.searchParams.set('subscription',data.subscriptionId);
    url.searchParams.set('token',data.publicToken);
    return url.toString();
  }

  async function pollPixStatus(id,token){
    let attempts=0;
    async function check(){
      attempts++;
      try{
        const current=await store.api('subscription-status',{id,token});
        if(current.status==='active'){
          $('pixMessage').textContent='Pagamento confirmado. Sua assinatura Itajaó está ativa!';
          $('pixMessage').className='club-message success';
          if(statusTimer)clearInterval(statusTimer);
        }else if(['cancelled','checkout_error','refunded'].includes(current.status)){
          $('pixMessage').textContent='O pagamento não foi concluído. Fale com a Itajaó se precisar de ajuda.';
          $('pixMessage').className='club-message error';
          if(statusTimer)clearInterval(statusTimer);
        }else{
          $('pixMessage').textContent='Aguardando a confirmação do PIX pelo Mercado Pago…';
          $('pixMessage').className='club-message info';
        }
      }catch(_){
        if(attempts>3)$('pixMessage').textContent='Ainda estamos aguardando a confirmação. Não gere outro PIX.';
      }
      if(attempts>=60&&statusTimer)clearInterval(statusTimer);
    }
    await check();
    statusTimer=setInterval(check,5000);
  }

  function showPix(data){
    $('customerPanel').hidden=true;
    $('subscriptionPayButton').hidden=true;
    $('subscriptionSetupNote').hidden=true;
    $('pixResult').hidden=false;
    const pix=data.pix||{};
    $('pixCopyPaste').value=pix.qrCode||'';
    if(pix.qrCodeBase64){
      $('pixQrImage').src='data:image/png;base64,'+pix.qrCodeBase64;
      $('pixQrImage').hidden=false;
    }
    $('pixStatusLink').href=statusUrl(data);
    setMessage('PIX criado. Use somente este código para evitar uma cobrança duplicada.','success');
    pollPixStatus(data.subscriptionId,data.publicToken);
  }

  async function submit(event){
    event.preventDefault();
    const form=$('subscriptionCheckoutForm');
    if(!form.reportValidity())return;
    if(!(config.checkout&&config.checkout.enabled)){
      setMessage('O checkout ainda está em homologação e não pode iniciar cobranças públicas.','error');
      return;
    }
    const button=$('subscriptionPayButton');
    button.disabled=true;
    setMessage('Validando plano, endereço e pagamento…','info');
    try{
      const data=await store.api('create-subscription-checkout',{
        clientRequestId:requestId(),
        selection:{plan:selection.plan,weight:selection.weight,format:selection.format,billing:selection.billing},
        acceptedTerms:true,
        customer:customerPayload(),
        address:addressPayload()
      });
      try{sessionStorage.setItem('itajaoPendingSubscription',JSON.stringify({id:data.subscriptionId,token:data.publicToken,statusUrl:statusUrl(data),createdAt:Date.now()}))}catch(_){}
      if(selection.billing==='pix'&&data.pix&&data.pix.qrCode){showPix(data);return}
      if(!data.checkoutUrl)throw new Error('O Mercado Pago não retornou a página de pagamento.');
      setMessage('Tudo certo. Redirecionando para o Mercado Pago…','success');
      location.assign(data.checkoutUrl);
    }catch(error){
      setMessage(error.message||'Não foi possível iniciar o pagamento.','error');
      button.disabled=!(config.checkout&&config.checkout.enabled);
    }
  }

  $('phone').addEventListener('input',event=>{
    const value=store.digits(event.target.value).slice(0,11);
    event.target.value=value.length>10?'('+value.slice(0,2)+') '+value.slice(2,7)+'-'+value.slice(7):value.length>6?'('+value.slice(0,2)+') '+value.slice(2,6)+'-'+value.slice(6):value;
  });
  $('document').addEventListener('input',event=>{event.target.value=store.digits(event.target.value).slice(0,14)});
  $('postalCode').addEventListener('input',event=>{event.target.value=store.digits(event.target.value).slice(0,8)});
  $('postalCode').addEventListener('blur',fillAddressFromCep);
  $('state').addEventListener('input',event=>{event.target.value=event.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,2)});
  $('copyPixButton').addEventListener('click',async()=>{
    const code=$('pixCopyPaste').value;
    try{
      await navigator.clipboard.writeText(code);
      $('copyPixButton').textContent='Código copiado';
      $('pixMessage').textContent='Código PIX copiado. Abra o aplicativo do seu banco para pagar.';
      $('pixMessage').className='club-message success';
    }catch(_){$('pixCopyPaste').focus();$('pixCopyPaste').select()}
  });
  $('subscriptionCheckoutForm').addEventListener('submit',submit);

  selection=readSelection();
  if(!selection||!pricing||!store){
    $('subscriptionCheckoutLayout').hidden=true;
    $('subscriptionCheckoutBlocker').hidden=false;
  }else render();
})();
