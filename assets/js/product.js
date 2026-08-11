(function(){
  'use strict';
  const store=window.ItajaoStore;
  const $=id=>document.getElementById(id);

  function render(product,key){
    document.title=product.name+' | Itajaó Cafés Especiais';$('crumbName').textContent=product.name;$('name').textContent=product.name;$('short').textContent=product.shortDescription||'';$('oldPrice').textContent=product.compareAtPrice?store.money(product.compareAtPrice):'';$('price').textContent=store.money(product.price);$('weight').textContent=product.weightLabel||'';$('format').textContent=product.format||'';$('description').textContent=product.description||'';
    const buyLink=$('buyLink');const legacyBuy=$('legacyBuy');buyLink.href=product.legacyUrl;legacyBuy.href=product.legacyUrl;
    if(product.available&&store.config.commerceCheckoutEnabled){buyLink.href='carrinho.html?add='+encodeURIComponent(key);buyLink.removeAttribute('target');buyLink.removeAttribute('rel');buyLink.textContent='Adicionar ao carrinho →';legacyBuy.hidden=false;$('pix').textContent='Pix, cartão e boleto no ambiente seguro do Mercado Pago'}
    else if(!product.available){$('pix').textContent='Produto marcado como esgotado';$('pix').classList.add('sold');buyLink.href=product.legacyUrl;buyLink.target='_blank';buyLink.rel='noopener';buyLink.textContent='Ver disponibilidade na loja atual →';legacyBuy.hidden=true}
    else{buyLink.href=product.legacyUrl;buyLink.target='_blank';buyLink.rel='noopener';buyLink.textContent='Comprar na loja atual →';legacyBuy.hidden=true;$('pix').textContent='O checkout próprio está em configuração'}
    const images=product.images||[];const main=$('mainImage');const thumbs=$('thumbs');thumbs.innerHTML='';main.src=images[0]||'assets/images/products/500graos.png';main.alt=product.name;main.style.display='block';
    if(images.length>1)images.forEach((src,index)=>{const button=document.createElement('button');button.className='thumb'+(index===0?' active':'');button.type='button';button.setAttribute('aria-label','Ver imagem '+(index+1));button.innerHTML='<img src="'+store.escapeHtml(src)+'" alt="Imagem '+(index+1)+' de '+store.escapeHtml(product.name)+'">';button.addEventListener('click',()=>{main.src=src;thumbs.querySelectorAll('.thumb').forEach(node=>node.classList.remove('active'));button.classList.add('active')});thumbs.appendChild(button)});
    store.updateCounters();
  }

  (async()=>{const catalog=await store.loadCatalog();const requested=new URLSearchParams(location.search).get('id');const key=catalog[requested]?requested:(catalog.graos500?'graos500':Object.keys(catalog)[0]);if(key)render(catalog[key],key)})();
})();
