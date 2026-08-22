(function(root){
  'use strict';

  function deepFreeze(value){
    if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
    Object.keys(value).forEach(function(key){deepFreeze(value[key]);});
    return Object.freeze(value);
  }

  root.ITAJAO_SUBSCRIPTION_CONFIG=deepFreeze({
    version:2,
    currency:'BRL',
    pixDiscountRate:0.05,
    freeShipping:true,
    couponEligible:false,
    checkout:{
      enabled:false,
      url:'assinatura-checkout.html'
    },
    plans:{
      monthly:{
        label:'Plano mensal',
        durationLabel:'Renovação mensal',
        shipments:1,
        pricePeriods:1,
        standardPayments:1,
        pricesCents:{'500g':8890,'1kg':14990}
      },
      annual:{
        label:'Plano anual',
        durationLabel:'12 meses',
        shipments:12,
        pricePeriods:12,
        standardPayments:12,
        pricesCents:{'500g':7490,'1kg':13690}
      }
    }
  });
})(typeof window!=='undefined'?window:globalThis);
