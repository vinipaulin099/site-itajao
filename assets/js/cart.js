(function(){
  'use strict';

  const store=window.ItajaoStore;
  const $=id=>document.getElementById(id);
  let catalog={};
  let coupon=null;
  let selectedShipping=null;
  let freeShippingThreshold=249.90;

  function setStatus(message,type){$('cartStatus').textContent=message||'';$('cartStatus').className='status'+(type?' '+type:'')}
  function setCouponStatus(message,type){$('couponStatus').textContent=message||'';$('couponStatus').className='coupon-status'+(type?' '+type:'')}
  function items(){return store.cartItems()}
  function invalidateQuote(message){selectedShipping=null;$('shippingList').innerHTML='';$('shippingTotal').textContent='Calcule o CEP';store.clearCheckout();if(message)setStatus(message,'info');updateSummary()}
  function invalidatePromotion(){coupon=null;$('couponCode').removeAttribute('disabled');$('removeCoupon').hidden=true;setCouponStatus('');invalidateQuote('Calcule o frete novamente após alterar o carrinho.')}

  function addFromUrl(){
    const url=new URL(location.href);const id=url.searchParams.get('add');
    if(id&&catalog[id]&&catalog[id].available){store.add(id,1);url.searchParams.delete('add');history.replaceState({},'',url.pathname+url.search+url.hash)}
  }
  function changeQuantity(id,delta){const current=store.getCart()[id]||0;store.setQuantity(id,current+delta);invalidatePromotion();render()}
  function removeItem(id){store.remove(id);invalidatePromotion();render()}

  function renderRows(){
    const host=$('cartItems');host.innerHTML='';const current=items();
    $('emptyCart').hidden=current.length>0;$('cartContent').hidden=current.length===0;
    current.forEach(item=>{
      const p=item.product;const row=document.createElement('article');row.className='cart-row';
      row.innerHTML='<a class="cart-image" href="produto.html?id='+encodeURIComponent(item.id)+'"><img src="'+store.escapeHtml(p.images[0])+'" alt="'+store.escapeHtml(p.name)+'"></a><div class="cart-copy"><a class="cart-name" href="produto.html?id='+encodeURIComponent(item.id)+'">'+store.escapeHtml(p.name)+'</a><span class="cart-meta">'+store.escapeHtml(p.format||p.weightLabel||'')+' · '+store.money(p.price)+' cada</span><button class="remove" type="button">Remover</button></div><div class="cart-actions"><div class="qty"><button type="button" aria-label="Diminuir '+store.escapeHtml(p.name)+'">−</button><span aria-live="polite">'+item.quantity+'</span><button type="button" aria-label="Aumentar '+store.escapeHtml(p.name)+'">+</button></div><strong>'+store.money(p.price*item.quantity)+'</strong></div>';
      const buttons=row.querySelectorAll('.qty button');buttons[0].addEventListener('click',()=>changeQuantity(item.id,-1));buttons[1].addEventListener('click',()=>changeQuantity(item.id,1));row.querySelector('.remove').addEventListener('click',()=>removeItem(item.id));host.appendChild(row);
    });
  }

  function renderRecommendations(){
    const inCart=new Set(items().map(item=>item.id));
    const products=Object.values(catalog).filter(product=>product.available&&!inCart.has(product.id)).slice(0,3);
    const host=$('recommendations');host.innerHTML='';$('recommendSection').hidden=!items().length||!products.length;
    products.forEach(product=>{
      const card=document.createElement('article');card.className='recommend-card';
      card.innerHTML='<a href="produto.html?id='+encodeURIComponent(product.id)+'"><img src="'+store.escapeHtml(product.images[0])+'" alt="'+store.escapeHtml(product.name)+'"></a><div><span>'+store.escapeHtml(product.format||product.weightLabel||'Café especial')+'</span><a href="produto.html?id='+encodeURIComponent(product.id)+'"><strong>'+store.escapeHtml(product.name)+'</strong></a><b>'+store.money(product.price)+'</b><button type="button">Adicionar ao carrinho</button></div>';
      card.querySelector('button').addEventListener('click',()=>{store.add(product.id,1);invalidatePromotion();render();setStatus(product.name+' foi adicionado ao carrinho.','success')});host.appendChild(card);
    });
  }

  function updateSummary(){
    const subtotal=store.subtotal();const discount=coupon?Number(coupon.discountAmount)||0:0;const shipping=selectedShipping?Number(selectedShipping.price)||0:0;
    $('subtotal').textContent=store.money(subtotal);$('discountLine').hidden=!discount;$('discountTotal').textContent='− '+store.money(discount);$('shippingTotal').textContent=selectedShipping?(shipping===0?'Grátis':store.money(shipping)):'Calcule o CEP';$('grandTotal').textContent=store.money(Math.max(0,subtotal-discount+shipping));
    const remaining=Math.max(0,freeShippingThreshold-subtotal);const progress=Math.min(100,subtotal/freeShippingThreshold*100);$('freeProgress').style.width=progress+'%';$('freeMessage').textContent=remaining>0?'Faltam '+store.money(remaining)+' para o frete grátis.':'Você alcançou o valor para frete grátis!';
    $('continueButton').disabled=!selectedShipping||!items().length||!store.config.commerceCheckoutEnabled;
  }

  function render(){renderRows();renderRecommendations();updateSummary();store.updateCounters()}

  async function applyCoupon(){
    const code=String($('couponCode').value||'').trim().toUpperCase();$('couponCode').value=code;
    if(!code){setCouponStatus('Digite o código do cupom.','error');return}
    if(!items().length)return;
    const button=$('applyCoupon');button.disabled=true;setCouponStatus('Validando cupom...');
    try{
      const data=await store.api('coupon-quote',{items:store.payload(),couponCode:code});
      if(!data.coupon)throw new Error('Cupom inválido.');coupon=data.coupon;$('couponCode').disabled=true;$('removeCoupon').hidden=false;
      const note=coupon.requiresCheckoutValidation?' A primeira compra será confirmada com os dados do checkout.':'';
      setCouponStatus(coupon.name+' aplicado.'+note,'success');invalidateQuote();updateSummary();
    }catch(error){coupon=null;setCouponStatus(error.message,'error');updateSummary()}finally{button.disabled=false}
  }

  function removeCoupon(){coupon=null;$('couponCode').disabled=false;$('couponCode').value='';$('removeCoupon').hidden=true;setCouponStatus('Cupom removido.','info');invalidateQuote();updateSummary()}

  async function quoteShipping(){
    const cep=store.digits($('postalCode').value);if(cep.length!==8){setStatus('Digite um CEP válido com 8 números.','error');return}
    if(!items().length)return;const button=$('quoteButton');button.disabled=true;setStatus('Consultando as transportadoras...');
    try{
      const data=await store.api('shipping-quote',{postalCode:cep,items:store.payload(),couponCode:coupon?.code||null});
      coupon=data.coupon||coupon;freeShippingThreshold=Number(data.freeShippingThreshold)||249.90;renderShipping(data.quotes||[]);setStatus(data.quotes&&data.quotes.length?'Escolha a forma de entrega.':'Nenhuma opção de frete encontrada para este CEP.',data.quotes&&data.quotes.length?'success':'error');updateSummary();
    }catch(error){setStatus(error.message,'error');invalidateQuote()}finally{button.disabled=false}
  }

  function renderShipping(quotes){
    const host=$('shippingList');host.innerHTML='';selectedShipping=null;
    quotes.forEach(quote=>{
      const label=document.createElement('label');label.className='shipping-option';const days=Number(quote.deliveryTime)||0;
      label.innerHTML='<input type="radio" name="shipping" value="'+quote.id+'"><div><strong>'+store.escapeHtml((quote.company?quote.company+' · ':'')+quote.name)+'</strong><span>'+(days?'Entrega estimada em até '+days+' dia'+(days===1?'':'s'):'Prazo informado pela transportadora')+'</span></div><b class="'+(Number(quote.price)===0?'free':'')+'">'+(Number(quote.price)===0?'Grátis':store.money(quote.price))+'</b>';
      label.querySelector('input').addEventListener('change',()=>{selectedShipping=quote;setStatus('Entrega selecionada.','success');updateSummary()});host.appendChild(label);
    });
  }

  function continueCheckout(){
    if(!selectedShipping)return;
    store.saveCheckout({postalCode:store.digits($('postalCode').value),shippingServiceId:selectedShipping.id,shipping:selectedShipping,couponCode:coupon?.code||null,coupon:coupon||null,freeShippingThreshold});
    location.href='checkout.html';
  }

  $('postalCode').addEventListener('input',event=>{let value=store.digits(event.target.value).slice(0,8);if(value.length>5)value=value.slice(0,5)+'-'+value.slice(5);event.target.value=value;invalidateQuote()});
  $('couponCode').addEventListener('input',event=>{event.target.value=event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,30)});
  $('applyCoupon').addEventListener('click',applyCoupon);$('removeCoupon').addEventListener('click',removeCoupon);$('quoteButton').addEventListener('click',quoteShipping);$('continueButton').addEventListener('click',continueCheckout);

  (async()=>{
    catalog=await store.loadCatalog();addFromUrl();render();
    if(!store.config.commerceCheckoutEnabled){$('closedNotice').hidden=false;setStatus('O novo checkout continua fechado enquanto os testes são concluídos.','info')}
  })();
})();
