import { Catalog, CartItem, cartSubtotal, loadCatalog, orderItemsSnapshot, validateCart } from '../_shared/catalog.ts';
import { commerceEnabled, env, handleOptions, json, parseJson, PublicError, publicErrorResponse, roundMoney, safeEqual } from '../_shared/core.ts';
import { insertOrder, logIntegration, releaseCouponRedemption, updateOrder } from '../_shared/db.ts';
import { fetchShippingQuotes } from '../_shared/shipping.ts';
import { applyCouponToShippingQuotes, quoteCoupon } from '../_shared/promotions.ts';
import { lookupCep, validateAddress, validateCustomer } from '../_shared/validation.ts';

function returnUrl(siteUrl: string, orderId: string, token: string, state: string) {
  const url = new URL('pedido.html', siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`);
  url.searchParams.set('order', orderId);
  url.searchParams.set('token', token);
  url.searchParams.set('return', state);
  return url.toString();
}

function isProtectedCheckoutTest(req: Request) {
  if (Deno.env.get('COMMERCE_ENABLED') === 'true') return false;
  const received = req.headers.get('x-admin-token') || '';
  const expected = Deno.env.get('ADMIN_SETUP_TOKEN')?.trim() || '';
  return Boolean(received && expected) && safeEqual(received, expected);
}

function paymentItems(items: CartItem[], catalog: Catalog, discountAmount: number) {
  const subtotal = cartSubtotal(items, catalog);
  const productTotal = roundMoney(subtotal - discountAmount);
  if (productTotal <= 0) throw new PublicError('O desconto não pode cobrir todo o valor dos produtos.', 409);
  let allocatedDiscount = 0;
  return items.map((item, index) => {
    const product = catalog[item.id];
    const lineTotal = roundMoney(product.price * item.quantity);
    const allocation = index === items.length - 1
      ? roundMoney(discountAmount - allocatedDiscount)
      : roundMoney(discountAmount * lineTotal / subtotal);
    allocatedDiscount = roundMoney(allocatedDiscount + allocation);
    return {
      id: product.sku,
      title: item.quantity > 1 ? `${item.quantity}× ${product.name}` : product.name,
      currency_id: 'BRL',
      quantity: 1,
      unit_price: roundMoney(lineTotal - allocation),
    };
  });
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  let orderId: string | null = null;
  try {
    const protectedTest = isProtectedCheckoutTest(req);
    if (!protectedTest) commerceEnabled();
    if (protectedTest && Deno.env.get('MP_USE_SANDBOX') !== 'true') {
      throw new PublicError('O checkout de teste protegido exige o Mercado Pago Sandbox.', 503);
    }
    const body = await parseJson(req);
    const catalog = await loadCatalog();
    const items = validateCart(body?.items, catalog);
    const customer = validateCustomer(body?.customer);
    const address = validateAddress(body?.address);
    const destination = await lookupCep(address.postalCode);
    if (destination?.state && destination.state !== address.state) throw new PublicError('A UF informada não corresponde ao CEP. Confira o endereço.');

    const shippingServiceId = Number(body?.shippingServiceId);
    if (!Number.isInteger(shippingServiceId) || shippingServiceId <= 0) throw new PublicError('Escolha uma opção de frete.');
    const shippingResult = await fetchShippingQuotes(address.postalCode, items, { catalog });
    const subtotal = cartSubtotal(items, catalog);
    const coupon = await quoteCoupon(body?.couponCode, subtotal, customer);
    const shippingQuotes = applyCouponToShippingQuotes(shippingResult.quotes, coupon);
    const shipping = shippingQuotes.find((quote) => quote.id === shippingServiceId);
    if (!shipping) throw new PublicError('A opção de frete mudou. Calcule o frete novamente.', 409);

    const discountAmount = coupon?.discountAmount || 0;
    const shippingAmount = roundMoney(shipping.price);
    const order = await insertOrder({
      customer,
      address,
      items: orderItemsSnapshot(items, catalog),
      subtotal,
      discountAmount,
      couponCode: coupon?.code || null,
      shippingAmount,
      shippingCost: shipping.cost,
      shippingServiceId: shipping.id,
      shippingServiceName: shipping.name,
      shippingCarrier: shipping.company,
      shippingQuote: shipping.raw,
    });
    if (!order?.id || !order?.public_token) throw new PublicError('Não foi possível criar o pedido.', 500);
    orderId = order.id;

    const siteUrl = env('SITE_URL');
    const nameParts = customer.name.split(/\s+/);
    const firstName = nameParts.shift() || customer.name;
    const lastName = nameParts.join(' ') || firstName;
    const notificationUrl = `${env('SUPABASE_URL')}/functions/v1/mercadopago-webhook`;
    const preferenceBody = {
      items: paymentItems(items, catalog, Number(order.discount_amount ?? discountAmount)),
      shipments: { cost: shippingAmount, mode: 'not_specified' },
      payer: {
        name: firstName,
        surname: lastName,
        email: customer.email,
        phone: { area_code: customer.phone.slice(0, 2), number: customer.phone.slice(2) },
        identification: { type: customer.personType === 'J' ? 'CNPJ' : 'CPF', number: customer.document },
      },
      external_reference: order.id,
      notification_url: notificationUrl,
      back_urls: {
        success: returnUrl(siteUrl, order.id, order.public_token, 'success'),
        pending: returnUrl(siteUrl, order.id, order.public_token, 'pending'),
        failure: returnUrl(siteUrl, order.id, order.public_token, 'failure'),
      },
      auto_return: 'approved',
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('MP_ACCESS_TOKEN')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(preferenceBody),
    });
    const preference = await mpResponse.json().catch(() => ({}));
    if (!mpResponse.ok || !preference?.id) {
      console.error('Mercado Pago preference error', mpResponse.status, preference);
      await updateOrder(order.id, { checkout_status: 'checkout_error', integration_error: `Mercado Pago ${mpResponse.status}: ${String(preference?.message || 'erro ao criar preferência').slice(0, 600)}` });
      await logIntegration(order.id, 'mercadopago', 'preference_create', false, String(preference?.message || 'Falha ao criar preferência'));
      throw new PublicError('Não foi possível abrir o pagamento agora. Tente novamente em instantes.', 502);
    }
    const checkoutUrl = Deno.env.get('MP_USE_SANDBOX') === 'true' ? preference.sandbox_init_point : preference.init_point;
    if (!checkoutUrl) throw new PublicError('O Mercado Pago não retornou a URL de pagamento.', 502);
    await updateOrder(order.id, { mp_preference_id: preference.id, integration_error: null });
    await logIntegration(order.id, 'mercadopago', 'preference_create', true, `Preferência ${preference.id} criada.`, preference.id);
    return json({
      orderId: order.id,
      checkoutUrl,
      subtotal: Number(order.subtotal ?? subtotal),
      discountAmount: Number(order.discount_amount ?? discountAmount),
      shippingAmount: Number(order.shipping_amount ?? shippingAmount),
      total: Number(order.total),
      couponCode: order.coupon_code || null,
    });
  } catch (error) {
    if (orderId) {
      console.error('create-checkout failed for order', orderId, error);
      await releaseCouponRedemption(orderId).catch((releaseError) => {
        console.error('Falha ao liberar reserva de cupom', orderId, releaseError);
      });
    }
    return publicErrorResponse(error);
  }
});
