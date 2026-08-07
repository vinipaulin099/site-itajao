(function(){
  'use strict';

  const CATALOG={
    graos500:{name:'Itajaó Especial 500g em Grãos',price:56.90,image:'500graos.png',available:true,legacyUrl:'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-500g-graos-torra-media-100-arabica-sul-de-minas-itajao/'},
    moido500:{name:'Itajaó Especial 500g Moído',price:54.90,image:'500moido.png',available:true,legacyUrl:'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-500g-moido-torra-media-100-arabica-sul-de-minas-itajao/'},
    graos250:{name:'Itajaó Especial 250g em Grãos',price:31.90,image:'250graos.png',available:false,legacyUrl:'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-250g-graos-torra-media-100-arabica-sul-de-minas-itajao/'},
    moido250:{name:'Itajaó Especial 250g Moído',price:29.90,image:'250moido.png',available:true,legacyUrl:'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-250g-moido-torra-media-100-arabica-sul-de-minas-itajao/'},
    kit1kg:{name:'Kit Itajaó Especial 1kg',price:103.90,image:'500graos.png',available:true,legacyUrl:'https://cafeitajao.com.br/produtos/kit-1kg-cafe-especial-84-pontos-sca-torra-media-100-arabica-sul-de-minas-itajao/'}
  };
  const STORE_KEY='itajaoCartV1';
  const cfg=window.ITAJAO_STORE_CONFIG||{};
  let cart=readCart();
  let selectedShipping=null;

  const $=id=>document.getElementById(id);
  const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
  const digits=value=>String(value||'').replace(/\D/g,'');
  const itemsPayload=()=>Object.entries(cart).filter(([id,q])=>CATALOG[id]&&CATALOG[id].available&&q>0).map(([id,quantity])=>({id,quantity}));
  const subtotalValue=()=>itemsPayload().reduce((sum,item)=>sum+CATALOG[item.id].price*item.quantity,0);

  function readCart(){
    try{
      const parsed=JSON.parse(localStorage.getItem(STORE_KEY)||'{}');
      return Object.fromEntries(Object.entries(parsed).filter(([id,q])=>CATALOG[id]&&Number.isInteger(q)&&q>0&&q<=10));
    }catch(_){return {}}
  }
  function saveCart(){try{localStorage.setItem(STORE_KEY,JSON.stringify(cart))}catch(_){}}
  function addFromUrl(){
    const url=new URL(location.href);const id=url.searchParams.get('add');
    if(id&&CATALOG[id]&&CATALOG[id].available){cart[id]=Math.min(10,(cart[id]||0)+1);saveCart();url.searchParams.delete('add');history.replaceState({},'',url.pathname+url.search+url.hash)}
  }
  function setStatus(message,type){$('status').textContent=message||'';$('status').className='status'+(type?' '+type:'')}
  function resetShipping(){selectedShipping=null;$('shippingList').innerHTML='';$('shippingTotal').textContent='Calcule o CEP';$('grandTotal').textContent=money(subtotalValue());$('payButton').disabled=true}
  function renderCart(){
    const host=$('cart');host.innerHTML='';const items=itemsPayload();
    if(!items.length){host.innerHTML='<div class="empty">Seu carrinho está vazio.<br><a href="index.html#cafes">Escolher um café</a></div>';$('checkoutForm').classList.add('loading');$('payButton').disabled=true;updateSummary();return}
    $('checkoutForm').classList.remove('loading');
    items.forEach(item=>{
      const p=CATALOG[item.id];const row=document.createElement('div');row.className='cart-row';
      row.innerHTML='<img class="cart-img" src="'+p.image+'" alt=""><div><div class="cart-name">'+p.name+'</div><div class="cart-price">'+money(p.price)+' cada</div><button class="remove" type="button">Remover</button></div><div class="qty"><button type="button" aria-label="Diminuir quantidade">−</button><span>'+item.quantity+'</span><button type="button" aria-label="Aumentar quantidade">+</button></div>';
      const buttons=row.querySelectorAll('.qty button');buttons[0].addEventListener('click',()=>changeQty(item.id,-1));buttons[1].addEventListener('click',()=>changeQty(item.id,1));row.querySelector('.remove').addEventListener('click',()=>removeItem(item.id));host.appendChild(row);
    });
    $('legacyLink').href=CATALOG[items[0].id].legacyUrl;updateSummary();
  }
  function changeQty(id,delta){const next=(cart[id]||0)+delta;if(next<1)delete cart[id];else cart[id]=Math.min(10,next);saveCart();resetShipping();renderCart()}
  function removeItem(id){delete cart[id];saveCart();resetShipping();renderCart()}
  function updateSummary(){const subtotal=subtotalValue();$('subtotal').textContent=money(subtotal);const shipping=selectedShipping?Number(selectedShipping.price):0;$('grandTotal').textContent=money(subtotal+shipping)}

  async function api(path,body){
    if(!cfg.functionsBaseUrl)throw new Error('Checkout ainda não configurado.');
    const headers={'Content-Type':'application/json'};
    if(cfg.supabasePublishableKey){headers.apikey=cfg.supabasePublishableKey;headers.Authorization='Bearer '+cfg.supabasePublishableKey}
    const response=await fetch(cfg.functionsBaseUrl+'/'+path,{method:'POST',headers,body:JSON.stringify(body)});
    let data={};try{data=await response.json()}catch(_){}
    if(!response.ok){const error=new Error(data.error||data.message||'Não foi possível concluir a operação.');error.status=response.status;throw error}
    return data;
  }

  async function fillAddressFromCep(cep){
    try{
      const response=await fetch('https://viacep.com.br/ws/'+cep+'/json/');if(!response.ok)return;const data=await response.json();if(data.erro)return;
      if(data.logradouro)$('street').value=data.logradouro;if(data.bairro)$('district').value=data.bairro;if(data.localidade)$('city').value=data.localidade;if(data.uf)$('state').value=data.uf;
    }catch(_){}
  }

  async function quoteShipping(){
    const cep=digits($('postalCode').value);if(cep.length!==8){setStatus('Digite um CEP válido com 8 números.','error');return}
    const items=itemsPayload();if(!items.length)return;const button=$('quoteButton');button.disabled=true;setStatus('Consultando as transportadoras...');$('setupNote').classList.remove('show');
    try{
      const [data]=await Promise.all([api('shipping-quote',{postalCode:cep,items}),fillAddressFromCep(cep)]);renderShipping(data.quotes||[]);setStatus(data.quotes&&data.quotes.length?'Escolha uma opção de entrega.':'Nenhuma opção de frete encontrada para este CEP.',data.quotes&&data.quotes.length?'success':'error');
    }catch(error){setStatus(error.message,'error');if(error.status===503)$('setupNote').classList.add('show');resetShipping()}finally{button.disabled=false}
  }

  function renderShipping(quotes){
    const host=$('shippingList');host.innerHTML='';selectedShipping=null;
    quotes.forEach((q,index)=>{
      const label=document.createElement('label');label.className='shipping-option';const days=Number(q.deliveryTime)||0;const priceClass=Number(q.price)===0?'ship-price free':'ship-price';
      label.innerHTML='<input type="radio" name="shipping" value="'+q.id+'"><div class="ship-copy"><div class="ship-name">'+escapeHtml((q.company?q.company+' · ':'')+q.name)+'</div><div class="ship-time">'+(days?'Entrega estimada em até '+days+' dia'+(days===1?'':'s'):'Prazo informado pela transportadora')+'</div></div><div class="'+priceClass+'">'+(Number(q.price)===0?'Grátis':money(q.price))+'</div>';
      label.querySelector('input').addEventListener('change',()=>{selectedShipping=q;$('shippingTotal').textContent=Number(q.price)===0?'Grátis':money(q.price);$('payButton').disabled=false;updateSummary()});host.appendChild(label);
      if(index===0)label.querySelector('input').checked=false;
    });
  }
  function escapeHtml(value){return String(value||'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
  function customerPayload(){return {name:$('fullName').value.trim(),email:$('email').value.trim().toLowerCase(),phone:digits($('phone').value),document:digits($('document').value)}}
  function addressPayload(){return {postalCode:digits($('postalCode').value),street:$('street').value.trim(),number:$('number').value.trim(),complement:$('complement').value.trim(),district:$('district').value.trim(),city:$('city').value.trim(),state:$('state').value.trim().toUpperCase()}}

  async function submitCheckout(event){
    event.preventDefault();const form=$('checkoutForm');if(!form.reportValidity())return;if(!selectedShipping){setStatus('Calcule o frete e escolha uma opção de entrega.','error');return}
    const button=$('payButton');button.disabled=true;setStatus('Preparando seu pagamento seguro...');$('setupNote').classList.remove('show');
    try{
      const data=await api('create-checkout',{items:itemsPayload(),shippingServiceId:selectedShipping.id,customer:customerPayload(),address:addressPayload()});
      if(!data.checkoutUrl)throw new Error('O Mercado Pago não retornou a página de pagamento.');setStatus('Tudo certo. Redirecionando para o Mercado Pago...','success');location.href=data.checkoutUrl;
    }catch(error){setStatus(error.message,'error');if(error.status===503)$('setupNote').classList.add('show');button.disabled=false}
  }

  $('postalCode').addEventListener('input',event=>{let value=digits(event.target.value).slice(0,8);if(value.length>5)value=value.slice(0,5)+'-'+value.slice(5);event.target.value=value;resetShipping()});
  $('postalCode').addEventListener('blur',()=>{if(digits($('postalCode').value).length===8&&$('shippingList').children.length===0)fillAddressFromCep(digits($('postalCode').value))});
  $('quoteButton').addEventListener('click',quoteShipping);$('checkoutForm').addEventListener('submit',submitCheckout);
  addFromUrl();renderCart();
})();

