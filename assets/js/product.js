(function(){
  'use strict';
  const store=window.ItajaoStore;
  const $=id=>document.getElementById(id);

  function render(product,key){
    document.title=product.name+' | Itajaó Cafés Especiais';$('crumbName').textContent=product.name;$('name').textContent=product.name;$('short').textContent=product.shortDescription||'';$('oldPrice').textContent=product.compareAtPrice?store.money(product.compareAtPrice):'';$('price').textContent=store.money(product.price);$('weight').textContent=product.weightLabel||'';$('format').textContent=product.format||'';$('description').textContent=product.description||'';
    const addButton=$('addToCart');const buyButton=$('buyNow');
    if(product.available){
      $('pix').textContent='Pix, cartão e boleto no ambiente seguro do Mercado Pago';
      addButton.addEventListener('click',()=>{store.add(key,1);addButton.textContent='Adicionado ao carrinho ✓';setTimeout(()=>{addButton.textContent='Adicionar ao carrinho'},1200)});
      buyButton.addEventListener('click',()=>{store.add(key,1);location.href='carrinho.html'});
    }else{$('pix').textContent='Produto esgotado';$('pix').classList.add('sold');addButton.disabled=true;buyButton.disabled=true;addButton.textContent='Produto esgotado';buyButton.textContent='Indisponível'}
    const images=product.images||[];const main=$('mainImage');const thumbs=$('thumbs');thumbs.innerHTML='';main.src=images[0]||'assets/images/products/500graos.png';main.alt=product.name;main.style.display='block';
    if(images.length>1)images.forEach((src,index)=>{const button=document.createElement('button');button.className='thumb'+(index===0?' active':'');button.type='button';button.setAttribute('aria-label','Ver imagem '+(index+1));button.innerHTML='<img src="'+store.escapeHtml(src)+'" alt="Imagem '+(index+1)+' de '+store.escapeHtml(product.name)+'">';button.addEventListener('click',()=>{main.src=src;thumbs.querySelectorAll('.thumb').forEach(node=>node.classList.remove('active'));button.classList.add('active')});thumbs.appendChild(button)});
    store.updateCounters();
    window.ITAJAO_CURRENT_PRODUCT={key:key,product:product};
    window.dispatchEvent(new CustomEvent('itajao:product-rendered',{detail:{key:key,product:product}}));
  }

  (async()=>{const catalog=await store.loadCatalog();const requested=new URLSearchParams(location.search).get('id');const key=catalog[requested]?requested:(catalog.graos500?'graos500':Object.keys(catalog)[0]);if(key)render(catalog[key],key)})();
})();
