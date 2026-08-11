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
      if(!product.available&&badge){badge.textContent='Esgotado';badge.classList.add('pbadge-ltd')}
    });
    store.updateCounters();
  })();
})();
