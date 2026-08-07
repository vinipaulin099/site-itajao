import { CATALOG, cartSubtotal, orderItemsSnapshot, validateCart } from '../_shared/catalog.ts';
import { commerceEnabled, env, handleOptions, json, parseJson, PublicError, publicErrorResponse, roundMoney } from '../_shared/core.ts';
import { insertOrder, logIntegration, updateOrder } from '../_shared/db.ts';
import { fetchShippingQuotes } from '../_shared/shipping.ts';
import { lookupCep, validateAddress, validateCustomer } from '../_shared/validation.ts';

function returnUrl(siteUrl: string, orderId: string, token: string, state: string) {
  const url = new URL('pedido.html', siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`);
  url.searchParams.set('order', orderId);
  url.searchParams.set('token', token);
  url.searchParams.set('return', state);
  return url.toString();
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  let orderId: string | null = null;
  try {
    commerceEnabled();
    const body = await parseJson(req);
    const items = validateCart(body?.items);
    const customer = validateCustomer(body?.customer);
    const address = validateAddress(body?.address);
    const destination = await lookupCep(address.postalCode);
    if (destination?.state && destination.state !== address.state) throw new PublicError('A UF informada não corresponde ao CEP. Confira o endereço.');

    const shippingServiceId = Number(body?.shippingServiceId);
    if (!Number.isInteger(shippingServiceId) || shippingServiceId <= 0) throw new PublicError('Escolha uma opção de frete.');
    const shippingResult = await fetchShippingQuotes(address.postalCode, items);
    const shipping = shippingResult.quotes.find((quote) => quote.id === shippingServiceId);
    if (!shipping) throw new PublicError('A opção de frete mudou. Calcule o frete novamente.', 409);

    const subtotal = cartSubtotal(items);
    const shippingAmount = roundMoney(shipping.price);
    const order = await insertOrder({
      customer,
      address,
      items: orderItemsSnapshot(items),
      subtotal,
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
      items: items.map((item) => ({
        id: CATALOG[item.id].sku,
        title: CATALOG[item.id].name,
        currency_id: 'BRL',
        quantity: item.quantity,
        unit_price: CATALOG[item.id].price,
      })),
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
    return json({ orderId: order.id, checkoutUrl });
  } catch (error) {
    if (orderId) console.error('create-checkout failed for order', orderId, error);
    return publicErrorResponse(error);
  }
});
