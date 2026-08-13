(function(){
  'use strict';

  const FALLBACK_PRODUCTS=[
    {id:'graos500',sku:'ITAJAO-GRAOS-500',name:'Itajaó Especial 500g em Grãos',price:56.90,compareAtPrice:62.90,weightLabel:'500g',format:'Em Grãos',shortDescription:'Café especial em grãos para moer na hora e aproveitar o máximo de aroma e frescor.',description:'Produzido na Fazenda Itajaó, este lote de 500g em grãos preserva o café inteiro até o preparo e permite ajustar a moagem ao método preferido.',images:['assets/images/products/real/graos-500-estudio.jpg','assets/images/products/real/graos-500-cafeteria.jpg'],legacyUrl:'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-500g-graos-torra-media-100-arabica-sul-de-minas-itajao/',available:true},
    {id:'moido500',sku:'ITAJAO-MOIDO-500',name:'Itajaó Especial 500g Moído',price:54.90,compareAtPrice:60.90,weightLabel:'500g',format:'Moído',shortDescription:'A praticidade do café já moído sem abrir mão do perfil especial do Itajaó.',description:'A versão de 500g moída foi pensada para o preparo prático do dia a dia, mantendo notas de chocolate, caramelo e castanha.',images:['assets/images/products/real/moido-500-estudio.jpg'],legacyUrl:'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-500g-moido-torra-media-100-arabica-sul-de-minas-itajao/',available:true}
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
        const activeIds=new Set(FALLBACK_PRODUCTS.map(product=>String(product.id)));
        catalog=toCatalog(data.products.filter(product=>activeIds.has(String(product.id))));sanitizeCart();writeJson(CART_KEY,cart);updateCounters();return catalog;
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
    api,money,digits,escapeHtml,updateCounters
  };
  sanitizeCart();updateCounters();
})();
