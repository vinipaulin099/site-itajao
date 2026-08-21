(function(){
  'use strict';
  const store=window.ItajaoStore;
  (async()=>{
    const catalog=await store.loadCatalog();
    document.querySelectorAll('[data-product-id]').forEach(card=>{
      const product=catalog[card.dataset.productId];if(!product){card.hidden=true;return}
      const name=card.querySelector('.pnome');const price=card.querySelector('.ppreco');const image=card.querySelector('.pimg img');const badge=card.querySelector('.pbadge');
      if(name)name.textContent=product.name;
      if(price)price.innerHTML=(product.compareAtPrice?'<span class="pold">'+store.money(product.compareAtPrice)+'</span>':'')+store.money(product.price);
      if(image){image.src=product.images[0];image.alt=product.name}
      card.setAttribute('aria-label','Ver '+product.name);
      const legacyButton=card.querySelector('.btn-buy');if(legacyButton)legacyButton.remove();
      const actions=document.createElement('div');actions.className='product-actions';
      actions.innerHTML='<button class="product-action add" type="button">Adicionar ao carrinho</button><button class="product-action buy-now" type="button">Comprar agora</button>';
      const addButton=actions.querySelector('.add');const buyButton=actions.querySelector('.buy-now');
      if(!product.available){if(badge){badge.textContent='Esgotado';badge.classList.add('pbadge-ltd')}addButton.disabled=true;buyButton.disabled=true;addButton.textContent='Esgotado';buyButton.textContent='Indisponível'}
      else{
        addButton.addEventListener('click',event=>{event.stopPropagation();store.add(product.id,1);addButton.textContent='Adicionado';setTimeout(()=>{addButton.textContent='Adicionar ao carrinho'},1200)});
        buyButton.addEventListener('click',event=>{event.stopPropagation();store.add(product.id,1);location.href='carrinho.html'});
      }
      card.querySelector('.pinfo').appendChild(actions);
      const openProduct=()=>{location.href=card.dataset.productHref};
      card.addEventListener('click',event=>{if(!event.target.closest('button'))openProduct()});
      card.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.target.closest('button')){event.preventDefault();openProduct()}});
    });
    const ratingNodes=Array.from(document.querySelectorAll('[data-review-sku]'));
    const summaries=await store.loadReviewSummaries(ratingNodes.map(node=>node.dataset.reviewSku));
    ratingNodes.forEach(node=>store.renderReviewSummary(node,summaries[String(node.dataset.reviewSku||'').toUpperCase()]));
    store.updateCounters();
  })();
})();
