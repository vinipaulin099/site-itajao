import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [page,script,configSource,styles,faq,home] = await Promise.all([
  readFile(new URL('../assinatura.html',import.meta.url),'utf8'),
  readFile(new URL('../assets/js/subscription.js',import.meta.url),'utf8'),
  readFile(new URL('../assets/js/subscription-config.js',import.meta.url),'utf8'),
  readFile(new URL('../assets/css/subscription.css',import.meta.url),'utf8'),
  readFile(new URL('../perguntas-frequentes.html',import.meta.url),'utf8'),
  readFile(new URL('../index.html',import.meta.url),'utf8')
]);

await import('../assets/js/subscription-config.js');
await import('../assets/js/subscription.js');

const config=globalThis.ITAJAO_SUBSCRIPTION_CONFIG;
const calculate=globalThis.ItajaoSubscriptionPricing.calculate;

test('calcula o plano mensal com 5% no PIX sobre apenas um mês',()=>{
  const standard500=calculate(config,'monthly','500g','standard');
  const pix500=calculate(config,'monthly','500g','pix');
  const pix1kg=calculate(config,'monthly','1kg','pix');

  assert.equal(standard500.unitPriceCents,8890);
  assert.equal(standard500.originalTotalCents,8890);
  assert.equal(pix500.finalTotalCents,8446);
  assert.equal(pix500.discountCents,444);
  assert.equal(pix1kg.finalTotalCents,14241);
  assert.equal(pix1kg.discountCents,749);
});

test('calcula o plano anual com 12 cobranças ou PIX sobre os 12 meses',()=>{
  const standard500=calculate(config,'annual','500g','standard');
  const pix500=calculate(config,'annual','500g','pix');
  const standard1kg=calculate(config,'annual','1kg','standard');
  const pix1kg=calculate(config,'annual','1kg','pix');

  assert.equal(standard500.unitPriceCents,7490);
  assert.equal(standard500.standardPayments,12);
  assert.equal(standard500.originalTotalCents,89880);
  assert.equal(pix500.finalTotalCents,85386);
  assert.equal(pix500.discountCents,4494);
  assert.equal(standard1kg.unitPriceCents,13690);
  assert.equal(standard1kg.originalTotalCents,164280);
  assert.equal(pix1kg.finalTotalCents,156066);
  assert.equal(pix1kg.discountCents,8214);
});

test('mantém frete grátis e bloqueia cupons em todos os planos',()=>{
  for(const plan of ['monthly','annual']){
    for(const weight of ['500g','1kg']){
      for(const billing of ['standard','pix']){
        const result=calculate(config,plan,weight,billing);
        assert.equal(result.freeShipping,true);
        assert.equal(result.shippingAmountCents,0);
        assert.equal(result.couponEligible,false);
      }
    }
  }
  assert.equal(config.pixDiscountRate,0.05);
  assert.equal(config.checkout.enabled,false);
});

test('entrega a nova jornada comercial e responsiva sem o fluxo antigo',()=>{
  assert.match(page,/name="plan"[^>]+value="monthly"/);
  assert.match(page,/name="plan"[^>]+value="annual"/);
  assert.match(page,/name="billing"[^>]+value="standard"/);
  assert.match(page,/name="billing"[^>]+value="pix"/);
  assert.match(page,/Frete grátis em todos os envios/);
  assert.match(page,/10% OFF em compras extras/);
  assert.match(page,/3º/);
  assert.match(page,/6º/);
  assert.match(page,/12º/);
  assert.match(page,/id="subscriptionCta"/);
  assert.match(script,/shippingAmountCents:0/);
  assert.match(script,/couponEligible:false/);
  assert.match(styles,/@media\(max-width:720px\)/);
  assert.doesNotMatch(page,/Sob consulta|Confirmar pelo WhatsApp|subscriptionContact|BEMVINDO/);
  assert.doesNotMatch(page,/8% OFF/);
  assert.doesNotMatch(configSource,/pixDiscountRate:0\.08/);
});

test('remove explicações antigas da home e do FAQ',()=>{
  assert.match(home,/PIX oferece 5% de desconto/);
  assert.match(home,/Plano anual com 12 cobranças mensais/);
  assert.match(home,/Frete grátis em todos os envios/);
  assert.match(faq,/12 cobranças mensais/);
  assert.match(faq,/Cupons promocionais não podem ser aplicados/);
  assert.doesNotMatch(home,/12 envios em uma compra anual/);
  assert.doesNotMatch(home,/Plano anual com pagamento em até 12 vezes/);
  assert.doesNotMatch(faq,/compra única que pode ser parcelada/);
  assert.doesNotMatch(faq,/confirmar seu plano pelo WhatsApp/);
});
