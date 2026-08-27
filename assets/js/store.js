(function(){
  'use strict';

  const FALLBACK_PRODUCTS=[
    {id:'graos500',sku:'ITAJAO-GRAOS-500',name:'ITAJAÓ 500G EM GRÃOS',price:55.90,compareAtPrice:null,weightLabel:'500g',format:'Em Grãos',shortDescription:'Café especial em grãos para moer na hora e aproveitar o máximo de aroma e frescor.',description:'Produzido na Fazenda Itajaó, este lote de 500g em grãos preserva o café inteiro até o preparo e permite ajustar a moagem ao método preferido.',images:['assets/images/products/real/graos-500-estudio.jpg','assets/images/products/real/graos-500-cafeteria.jpg'],legacyUrl:'https://cafeitajao.com.br/',available:true},
    {id:'moido500',sku:'ITAJAO-MOIDO-500',name:'ITAJAÓ 500G MOÍDO',price:55.90,compareAtPrice:null,weightLabel:'500g',format:'Moído',shortDescription:'A praticidade do café já moído sem abrir mão do perfil especial do Itajaó.',description:'A versão de 500g moída foi pensada para o preparo prático do dia a dia, mantendo notas de chocolate, caramelo e castanha.',images:['assets/images/products/real/moido-500-estudio.jpg'],legacyUrl:'https://cafeitajao.com.br/',available:true},
    {id:'graos1kg',sku:'ITAJAO-1000-GRAOS',name:'ITAJAÓ 1KG EM GRÃOS',price:119.90,compareAtPrice:null,weightLabel:'1kg',format:'Em Grãos',shortDescription:'Dois pacotes de 500g para preservar melhor o frescor.',description:'Kit de 1kg composto por dois pacotes de 500g do Café Especial Itajaó em grãos.',images:['assets/images/products/real/graos-1kg-kit.jpg'],legacyUrl:'https://cafeitajao.com.br/',available:true},
    {id:'moido1kg',sku:'ITAJAO-1000-MOIDO',name:'ITAJAÓ 1KG MOÍDO',price:119.90,compareAtPrice:null,weightLabel:'1kg',format:'Moído',shortDescription:'Dois pacotes de 500g já moídos para o dia a dia.',description:'Kit de 1kg composto por dois pacotes de 500g do Café Especial Itajaó moído.',images:['assets/images/products/real/moido-1kg-kit.jpg'],legacyUrl:'https://cafeitajao.com.br/',available:true},
    {id:'graos3kg',sku:'ITAJAO-3000-GRAOS',name:'KIT ITAJAÓ 3KG EM GRÃOS',price:319.90,compareAtPrice:null,weightLabel:'3kg',format:'Em Grãos',shortDescription:'Seis pacotes de 500g para maior consumo sem abrir mão do frescor.',description:'Kit de 3kg do Café Especial Itajaó em grãos, composto por seis pacotes de 500g.',images:['assets/images/products/real/graos-3kg-kit.jpg'],legacyUrl:'https://cafeitajao.com.br/',available:true},
    {id:'moido3kg',sku:'ITAJAO-3000-MOIDO',name:'KIT ITAJAÓ 3KG MOÍDO',price:319.90,compareAtPrice:null,weightLabel:'3kg',format:'Moído',shortDescription:'Seis pacotes de 500g moídos para maior consumo e praticidade.',description:'Kit de 3kg do Café Especial Itajaó moído, composto por seis pacotes de 500g.',images:['assets/images/products/real/moido-3kg-kit.jpg'],legacyUrl:'https://cafeitajao.com.br/',available:true}
  ];

  const CART_KEY='itajaoCartV1';
  const CHECKOUT_KEY='itajaoCheckoutV2';
  const cfg=window.ITAJAO_STORE_CONFIG||{};
  let catalog=toCatalog(FALLBACK_PRODUCTS);
  let catalogPromise=null;
  let cart=readJson(CART_KEY,{});

  function toCatalog(products){
    return Object.fromEntries((products||[]).filter(product=>product&&product.id).map(product=>{
      const local=FALLBACK_PRODUCTS.find(item=>String(item.id)===String(product.id))||{};
      const normalized={...local,...product,price:Number(product.price)||0,compareAtPrice:product.compareAtPrice===null?null:Number(product.compareAtPrice)||null,available:Boolean(product.available),images:Array.isArray(local.images)&&local.images.length?local.images:(Array.isArray(product.images)&&product.images.length?product.images:['assets/images/products/real/graos-500-estudio.jpg'])};
      return [String(product.id),normalized];
    }));
  }
  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback}catch(_){return fallback}}
  function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch(_){}}
  function money(value){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0)}
  function digits(value){return String(value||'').replace(/\D/g,'')}
  function escapeHtml(value){return String(value||'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
  function headers(){
    const value={'Content-Type':'application/json'};
    if(cfg.supabasePublishableKey){value.apikey=cfg.supabasePublishableKey;value.Authorization='Bearer '+cfg.supabasePublishableKey}
    return value;
  }
  async function loadReviewSummaries(skus){
    const requested=Array.from(new Set((skus||[]).map(value=>String(value||'').trim().toUpperCase()).filter(Boolean)));
    const unavailable=()=>Object.fromEntries(requested.map(sku=>[sku,{sku,average:0,total:0,available:false}]));
    if(!requested.length)return {};
    if(!cfg.functionsBaseUrl)return unavailable();
    try{
      const query=new URLSearchParams({type:'review_summaries',skus:requested.join(',')});
      const response=await fetch(cfg.functionsBaseUrl+'/community-feed?'+query.toString(),{headers:headers()});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!Array.isArray(data.items))throw new Error(data.error||'Avaliações indisponíveis.');
      const summaries=Object.fromEntries(requested.map(sku=>[sku,{sku,average:0,total:0,available:true}]));
      data.items.forEach(item=>{
        const sku=String(item&&item.sku||'').toUpperCase();
        if(!summaries[sku])return;
        summaries[sku]={sku,average:Math.max(0,Math.min(5,Number(item.average)||0)),total:Math.max(0,Number(item.total)||0),available:true};
      });
      return summaries;
    }catch(error){console.warn('Resumo de avaliações indisponível.',error);return unavailable()}
  }
  function renderReviewSummary(node,summary){
    if(!node)return;
    const stars=node.querySelector('.product-rating-stars');
    const text=node.querySelector('.product-rating-text');
    if(!summary||summary.available===false){
      if(stars)stars.textContent='☆☆☆☆☆';
      if(text)text.textContent='Avaliações indisponíveis';
      node.setAttribute('aria-label','Avaliações temporariamente indisponíveis');
      return;
    }
    const total=Math.max(0,Number(summary.total)||0);
    const average=total?Math.max(0,Math.min(5,Number(summary.average)||0)):0;
    const filled=Math.round(average);
    if(stars)stars.textContent=total?'★'.repeat(filled)+'☆'.repeat(5-filled):'☆☆☆☆☆';
    if(stars)stars.classList.toggle('has-rating',total>0);
    if(total){
      const averageText=average.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
      const countText=total===1?'1 avaliação':total+' avaliações';
      if(text)text.textContent=averageText+' · '+countText;
      node.setAttribute('aria-label','Avaliação média '+averageText+' de 5, em '+countText);
    }else{
      if(text)text.textContent='0 avaliações';
      node.setAttribute('aria-label','Este produto ainda não recebeu avaliações');
    }
  }
  function notify(){
    sanitizeCart();writeJson(CART_KEY,cart);updateCounters();
    window.dispatchEvent(new CustomEvent('itajao:cart',{detail:{cart:{...cart},count:cartCount()}}));
  }
  function sanitizeCart(){
    cart=Object.fromEntries(Object.entries(cart||{}).filter(([id,quantity])=>catalog[id]&&catalog[id].available&&Number.isInteger(quantity)&&quantity>0&&quantity<=10));
  }
  function cartCount(){return Object.values(cart).reduce((sum,quantity)=>sum+Number(quantity||0),0)}
  function updateCounters(){
    document.querySelectorAll('[data-cart-count]').forEach(node=>{node.textContent=String(cartCount());node.hidden=cartCount()===0});
  }
  async function loadCatalog(){
    if(catalogPromise)return catalogPromise;
    catalogPromise=(async()=>{
      if(!cfg.functionsBaseUrl)return catalog;
      try{
        const response=await fetch(cfg.functionsBaseUrl+'/store-catalog',{headers:headers()});
        const data=await response.json().catch(()=>({}));
        if(!response.ok||!Array.isArray(data.products)||!data.products.length)throw new Error(data.error||'Catálogo indisponível.');
        // O backend é a fonte de verdade do catálogo. Isso permite novos tamanhos sem alterar este arquivo novamente.
        catalog=toCatalog(data.products);sanitizeCart();writeJson(CART_KEY,cart);updateCounters();return catalog;
      }catch(error){console.warn('Catálogo remoto indisponível; usando catálogo local.',error);return catalog}
    })();
    return catalogPromise;
  }
  async function api(path,body){
    if(!cfg.functionsBaseUrl)throw new Error('A loja ainda está sendo configurada.');
    const response=await fetch(cfg.functionsBaseUrl+'/'+path,{method:'POST',headers:headers(),body:JSON.stringify(body||{})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data.error||data.message||'Não foi possível concluir a operação.');error.status=response.status;throw error}
    return data;
  }
  function getCart(){sanitizeCart();return {...cart}}
  function cartItems(){
    sanitizeCart();
    return Object.entries(cart).map(([id,quantity])=>({id,quantity,product:catalog[id]}));
  }
  function add(id,quantity){
    const product=catalog[id];if(!product||!product.available)return false;
    const amount=Math.max(1,Number(quantity)||1);cart[id]=Math.min(10,(cart[id]||0)+amount);notify();return true;
  }
  function setQuantity(id,quantity){
    const amount=Number(quantity);if(!catalog[id]||!catalog[id].available)return false;
    if(!Number.isInteger(amount)||amount<1)delete cart[id];else cart[id]=Math.min(10,amount);notify();return true;
  }
  function remove(id){delete cart[id];notify()}
  function clear(){cart={};notify();clearCheckout()}
  function payload(){return cartItems().map(item=>({id:item.id,quantity:item.quantity}))}
  function subtotal(){return cartItems().reduce((sum,item)=>sum+item.product.price*item.quantity,0)}
  function fingerprint(){return payload().sort((a,b)=>a.id.localeCompare(b.id)).map(item=>item.id+':'+item.quantity).join('|')}
  function saveCheckout(value){writeJson(CHECKOUT_KEY,{...value,cartFingerprint:fingerprint(),savedAt:Date.now()})}
  function readCheckout(){return readJson(CHECKOUT_KEY,null)}
  function clearCheckout(){try{localStorage.removeItem(CHECKOUT_KEY)}catch(_){}}

  window.ItajaoStore={
    config:cfg,FALLBACK_PRODUCTS,loadCatalog,getCatalog:()=>catalog,getCart,cartItems,cartCount,
    add,setQuantity,remove,clear,payload,subtotal,fingerprint,saveCheckout,readCheckout,clearCheckout,
    api,money,digits,escapeHtml,updateCounters,loadReviewSummaries,renderReviewSummary
  };
  sanitizeCart();updateCounters();
})();
