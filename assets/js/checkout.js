(function(){
  'use strict';

  const store=window.ItajaoStore;
  const $=id=>document.getElementById(id);
  let checkout=null;

  function setStatus(message,type){$('status').textContent=message||'';$('status').className='status'+(type?' '+type:'')}
  function validCheckout(value){
    return value&&value.cartFingerprint===store.fingerprint()&&Number.isInteger(Number(value.shippingServiceId))&&store.digits(value.postalCode).length===8&&Date.now()-Number(value.savedAt||0)<2*60*60*1000;
  }
  function renderItems(){
    const host=$('orderItems');host.innerHTML='';
    store.cartItems().forEach(item=>{
      const row=document.createElement('div');row.className='order-row';
      row.innerHTML='<img src="'+store.escapeHtml(item.product.images[0])+'" alt=""><div><strong>'+store.escapeHtml(item.product.name)+'</strong><span>'+item.quantity+' × '+store.money(item.product.price)+'</span></div><b>'+store.money(item.product.price*item.quantity)+'</b>';host.appendChild(row);
    });
  }
  function renderSummary(){
    const subtotal=store.subtotal();const discount=Number(checkout?.coupon?.discountAmount)||0;const shipping=Number(checkout?.shipping?.price)||0;
    $('subtotal').textContent=store.money(subtotal);$('discountLine').hidden=!discount;$('discountTotal').textContent='− '+store.money(discount);$('shippingTotal').textContent=shipping===0?'Grátis':store.money(shipping);$('grandTotal').textContent=store.money(subtotal-discount+shipping);
    $('shippingName').textContent=(checkout.shipping.company?checkout.shipping.company+' · ':'')+checkout.shipping.name;
    const days=Number(checkout.shipping.deliveryTime)||0;$('shippingTime').textContent=days?'Entrega estimada em até '+days+' dia'+(days===1?'':'s'):'Prazo informado pela transportadora';
    $('couponSummary').hidden=!checkout.couponCode;if(checkout.couponCode)$('couponSummary').textContent='Cupom '+checkout.couponCode+' aplicado';
  }
  async function fillAddressFromCep(){
    const cep=store.digits(checkout.postalCode);$('postalCode').value=cep.slice(0,5)+'-'+cep.slice(5);
    try{
      const response=await fetch('https://viacep.com.br/ws/'+cep+'/json/');if(!response.ok)return;const data=await response.json();if(data.erro)return;
      if(data.logradouro)$('street').value=data.logradouro;if(data.bairro)$('district').value=data.bairro;if(data.localidade)$('city').value=data.localidade;if(data.uf)$('state').value=data.uf;
    }catch(_){}
  }
  function customerPayload(){return {name:$('fullName').value.trim(),email:$('email').value.trim().toLowerCase(),phone:store.digits($('phone').value),document:store.digits($('document').value)}}
  function addressPayload(){return {postalCode:store.digits(checkout.postalCode),street:$('street').value.trim(),number:$('number').value.trim(),complement:$('complement').value.trim(),district:$('district').value.trim(),city:$('city').value.trim(),state:$('state').value.trim().toUpperCase()}}

  async function submitCheckout(event){
    event.preventDefault();const form=$('checkoutForm');if(!form.reportValidity())return;
    if(!validCheckout(checkout)){setStatus('O carrinho ou o frete mudou. Volte ao carrinho e calcule novamente.','error');$('payButton').disabled=true;return}
    const button=$('payButton');button.disabled=true;setStatus('Preparando seu pagamento seguro...');
    try{
      const data=await store.api('create-checkout',{items:store.payload(),shippingServiceId:Number(checkout.shippingServiceId),couponCode:checkout.couponCode||null,customer:customerPayload(),address:addressPayload()});
      if(!data.checkoutUrl)throw new Error('O Mercado Pago não retornou a página de pagamento.');
      try{sessionStorage.setItem('itajaoPendingOrder',JSON.stringify({orderId:data.orderId,createdAt:Date.now()}))}catch(_){}
      setStatus('Tudo certo. Redirecionando para o Mercado Pago...','success');location.href=data.checkoutUrl;
    }catch(error){
      setStatus(error.message,'error');
      if(error.status===409){$('backToCart').classList.add('attention')}
      button.disabled=!store.config.commerceCheckoutEnabled;
    }
  }

  $('phone').addEventListener('input',event=>{const value=store.digits(event.target.value).slice(0,11);event.target.value=value.length>10?'('+value.slice(0,2)+') '+value.slice(2,7)+'-'+value.slice(7):value.length>6?'('+value.slice(0,2)+') '+value.slice(2,6)+'-'+value.slice(6):value});
  $('document').addEventListener('input',event=>{event.target.value=store.digits(event.target.value).slice(0,14)});
  $('state').addEventListener('input',event=>{event.target.value=event.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,2)});
  $('checkoutForm').addEventListener('submit',submitCheckout);

  (async()=>{
    await store.loadCatalog();checkout=store.readCheckout();
    if(!store.cartItems().length||!validCheckout(checkout)){
      $('checkoutLayout').hidden=true;$('checkoutBlocker').hidden=false;return;
    }
    renderItems();renderSummary();await fillAddressFromCep();
    if(!store.config.commerceCheckoutEnabled){$('setupNote').hidden=false;$('payButton').disabled=true;setStatus('O novo checkout continua fechado enquanto os testes são concluídos.','info')}
    else $('payButton').disabled=false;
  })();
})();
