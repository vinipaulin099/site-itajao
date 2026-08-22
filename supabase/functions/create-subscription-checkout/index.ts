import {
  env,
  handleOptions,
  json,
  parseJson,
  PublicError,
  publicErrorResponse,
  safeEqual,
} from '../_shared/core.ts';
import { lookupCep, validateAddress, validateCustomer } from '../_shared/validation.ts';
import { enqueueEmail } from '../_shared/email.ts';
import {
  createSubscriptionCheckout,
  logSubscriptionEvent,
  SubscriptionBillingMethod,
  SubscriptionCoffeeFormat,
  SubscriptionPlanType,
  updateSubscription,
} from '../_shared/subscriptions.ts';

function subscriptionCheckoutEnabled(req: Request) {
  if (Deno.env.get('SUBSCRIPTION_CHECKOUT_ENABLED') === 'true') return;
  const received = req.headers.get('x-admin-token') || '';
  const expected = Deno.env.get('ADMIN_SETUP_TOKEN')?.trim() || '';
  const protectedTest = Boolean(received && expected) && safeEqual(received, expected);
  if (!protectedTest) {
    throw new PublicError('A contratação online do Clube Itajaó ainda está em configuração.', 503);
  }
  if (Deno.env.get('MP_USE_SANDBOX') !== 'true') {
    throw new PublicError('O teste protegido da assinatura exige o Mercado Pago Sandbox.', 503);
  }
}

function subscriptionReturnUrl(siteUrl: string, subscriptionId: string, token: string, state: string) {
  const url = new URL('assinatura-status.html', siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`);
  url.searchParams.set('subscription', subscriptionId);
  url.searchParams.set('token', token);
  url.searchParams.set('return', state);
  return url.toString();
}

function uuid(value: unknown) {
  const result = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)) {
    throw new PublicError('Identificador da tentativa inválido. Atualize a página e tente novamente.');
  }
  return result;
}

function planType(value: unknown): SubscriptionPlanType {
  if (value === 'monthly' || value === 'annual') return value;
  throw new PublicError('Plano de assinatura inválido.');
}

function weightGrams(value: unknown): 500 | 1000 {
  if (value === '500g' || Number(value) === 500) return 500;
  if (value === '1kg' || Number(value) === 1000) return 1000;
  throw new PublicError('Peso da assinatura inválido.');
}

function coffeeFormat(value: unknown): SubscriptionCoffeeFormat {
  const normalized = String(value || '').trim().toLowerCase();
  if (['beans', 'em grãos', 'em graos', 'grãos', 'graos'].includes(normalized)) return 'beans';
  if (['ground', 'moído', 'moido'].includes(normalized)) return 'ground';
  throw new PublicError('Formato de café inválido.');
}

function billingMethod(value: unknown): SubscriptionBillingMethod {
  if (value === 'standard' || value === 'recurring') return 'recurring';
  if (value === 'pix') return 'pix';
  throw new PublicError('Forma de pagamento inválida.');
}

function nameParts(fullName: string) {
  const parts = fullName.split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || fullName;
  return { firstName, lastName: parts.join(' ') || firstName };
}

function annualEndDate(startDate: Date) {
  const endDate = new Date(startDate);
  endDate.setUTCMonth(endDate.getUTCMonth() + 12);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return endDate;
}

async function createPixPayment(subscription: any, customer: any, notificationUrl: string) {
  const names = nameParts(customer.name);
  const response = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('MP_ACCESS_TOKEN')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Idempotency-Key': subscription.id,
    },
    body: JSON.stringify({
      transaction_amount: Number(subscription.total_amount_cents) / 100,
      description: `${subscription.offer_name} · ${subscription.coffee_format === 'beans' ? 'Em grãos' : 'Moído'}`,
      payment_method_id: 'pix',
      external_reference: subscription.id,
      notification_url: notificationUrl,
      payer: {
        email: customer.email,
        first_name: names.firstName,
        last_name: names.lastName,
        identification: {
          type: customer.personType === 'J' ? 'CNPJ' : 'CPF',
          number: customer.document,
        },
      },
      metadata: {
        itajao_type: 'subscription',
        plan_type: subscription.plan_type,
        weight_grams: subscription.weight_grams,
      },
    }),
  });
  const payment = await response.json().catch(() => ({}));
  const checkoutUrl = payment?.point_of_interaction?.transaction_data?.ticket_url || '';
  if (!response.ok || !payment?.id || !checkoutUrl) {
    console.error('Mercado Pago subscription PIX error', response.status, payment);
    throw new PublicError('Não foi possível gerar o PIX agora. Tente novamente em instantes.', 502);
  }
  return {
    payment,
    checkoutUrl,
    pix: {
      qrCode: String(payment?.point_of_interaction?.transaction_data?.qr_code || ''),
      qrCodeBase64: String(payment?.point_of_interaction?.transaction_data?.qr_code_base64 || ''),
      expiresAt: payment?.date_of_expiration || null,
    },
  };
}

async function createRecurringCheckout(subscription: any, customer: any, backUrl: string) {
  const startDate = new Date(Date.now() + 5 * 60 * 1000);
  const autoRecurring: Record<string, unknown> = {
    frequency: 1,
    frequency_type: 'months',
    start_date: startDate.toISOString(),
    transaction_amount: Number(subscription.unit_price_cents) / 100,
    currency_id: 'BRL',
  };
  if (subscription.plan_type === 'annual') {
    autoRecurring.end_date = annualEndDate(startDate).toISOString();
  }

  const response = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('MP_ACCESS_TOKEN')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Idempotency-Key': subscription.id,
    },
    body: JSON.stringify({
      reason: subscription.offer_name,
      external_reference: subscription.id,
      payer_email: customer.email,
      auto_recurring: autoRecurring,
      back_url: backUrl,
      status: 'pending',
    }),
  });
  const preapproval = await response.json().catch(() => ({}));
  const checkoutUrl = Deno.env.get('MP_USE_SANDBOX') === 'true'
    ? (preapproval?.sandbox_init_point || preapproval?.init_point)
    : preapproval?.init_point;
  if (!response.ok || !preapproval?.id || !checkoutUrl) {
    console.error('Mercado Pago subscription preapproval error', response.status, preapproval);
    throw new PublicError('Não foi possível abrir a assinatura no Mercado Pago agora. Tente novamente em instantes.', 502);
  }
  return { preapproval, checkoutUrl };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  let subscriptionId: string | null = null;
  try {
    subscriptionCheckoutEnabled(req);
    const body = await parseJson(req);
    if (body?.couponCode) throw new PublicError('Cupons não podem ser aplicados à assinatura.');
    if (body?.acceptedTerms !== true) {
      throw new PublicError('Confirme os dados, o plano e a forma de pagamento para continuar.');
    }

    const customer = validateCustomer(body?.customer);
    const address = validateAddress(body?.address);
    const destination = await lookupCep(address.postalCode);
    if (destination?.state && destination.state !== address.state) {
      throw new PublicError('A UF informada não corresponde ao CEP. Confira o endereço.');
    }

    const selection = body?.selection || body;
    const subscription = await createSubscriptionCheckout({
      customer,
      address,
      planType: planType(selection?.plan || selection?.planKey),
      weightGrams: weightGrams(selection?.weight || selection?.weightGrams),
      coffeeFormat: coffeeFormat(selection?.format),
      billingMethod: billingMethod(selection?.billing),
      clientRequestId: uuid(body?.clientRequestId),
    });
    subscriptionId = subscription.id;

    if (subscription.checkout_url) {
      return json({
        subscriptionId: subscription.id,
        publicToken: subscription.public_token,
        subscriptionNumber: subscription.subscription_number,
        checkoutUrl: subscription.checkout_url,
        statusUrl: subscriptionReturnUrl(
          env('SITE_URL'),
          subscription.id,
          subscription.public_token,
          'retry',
        ),
      });
    }

    const siteUrl = env('SITE_URL');
    const notificationUrl = `${env('SUPABASE_URL')}/functions/v1/mercadopago-subscription-webhook`;
    const successUrl = subscriptionReturnUrl(siteUrl, subscription.id, subscription.public_token, 'success');
    let checkoutUrl = '';
    let pix: Record<string, unknown> | null = null;

    if (subscription.billing_method === 'pix') {
      const result = await createPixPayment(subscription, customer, notificationUrl);
      const { payment, checkoutUrl: pixUrl } = result;
      pix = result.pix;
      checkoutUrl = pixUrl;
      await updateSubscription(subscription.id, {
        mp_initial_payment_id: String(payment.id),
        mp_status: String(payment.status || 'pending'),
        checkout_url: checkoutUrl,
        status: 'checkout_pending',
      });
      await logSubscriptionEvent({
        subscriptionId: subscription.id,
        provider: 'mercadopago',
        eventType: 'pix_created',
        externalId: String(payment.id),
        ok: true,
        detail: `PIX ${payment.id} criado para ${subscription.subscription_number}.`,
      });
    } else {
      const { preapproval, checkoutUrl: recurringUrl } = await createRecurringCheckout(
        subscription,
        customer,
        successUrl,
      );
      checkoutUrl = recurringUrl;
      await updateSubscription(subscription.id, {
        mp_preapproval_id: String(preapproval.id),
        mp_status: String(preapproval.status || 'pending'),
        checkout_url: checkoutUrl,
        next_payment_at: preapproval.next_payment_date || null,
        status: 'checkout_pending',
      });
      await logSubscriptionEvent({
        subscriptionId: subscription.id,
        provider: 'mercadopago',
        eventType: 'preapproval_created',
        externalId: String(preapproval.id),
        ok: true,
        detail: `Pré-aprovação ${preapproval.id} criada para ${subscription.subscription_number}.`,
      });
    }

    try {
      await enqueueEmail({
        category: 'transactional',
        templateKey: 'subscription_checkout_created',
        recipientEmail: customer.email,
        recipientName: customer.name,
        senderKind: 'customer',
        subject: `Sua assinatura ${subscription.subscription_number} foi iniciada`,
        payload: {
          customer_name: customer.name,
          subscription_id: subscription.id,
          subscription_number: subscription.subscription_number,
          public_token: subscription.public_token,
          subscription_url: successUrl,
          plan_label: subscription.plan_type === 'annual' ? 'Clube Itajaó Anual' : 'Clube Itajaó Mensal',
          coffee_label: `${subscription.weight_grams === 1000 ? '1kg' : '500g'} · ${subscription.coffee_format === 'beans' ? 'Em grãos' : 'Moído'}`,
          billing_label: subscription.billing_method === 'pix' ? 'PIX com 5% OFF' : 'Cobrança mensal recorrente',
          total_amount: Number(subscription.total_amount_cents) / 100,
        },
        idempotencyKey: `subscription:${subscription.id}:checkout-created`,
        relatedCustomerId: subscription.customer_id,
        resourceType: 'subscription',
        resourceId: subscription.id,
        priority: 15,
      });
    } catch (emailError) {
      console.error('Subscription checkout email queue failed', subscription.id, emailError);
    }

    return json({
      subscriptionId: subscription.id,
      publicToken: subscription.public_token,
      subscriptionNumber: subscription.subscription_number,
      checkoutUrl,
      statusUrl: successUrl,
      pix,
      planType: subscription.plan_type,
      weightGrams: subscription.weight_grams,
      coffeeFormat: subscription.coffee_format,
      billingMethod: subscription.billing_method,
      unitPriceCents: subscription.unit_price_cents,
      originalTotalCents: subscription.original_total_cents,
      discountCents: subscription.discount_cents,
      totalAmountCents: subscription.total_amount_cents,
      shippingAmountCents: 0,
      couponEligible: false,
    });
  } catch (error) {
    if (subscriptionId) {
      const message = error instanceof Error ? error.message : String(error);
      await updateSubscription(subscriptionId, {
        status: 'checkout_error',
        mp_status: 'checkout_error',
      }).catch(() => null);
      await logSubscriptionEvent({
        subscriptionId,
        provider: 'mercadopago',
        eventType: 'checkout_create_failed',
        externalId: subscriptionId,
        ok: false,
        detail: message,
      });
    }
    return publicErrorResponse(error);
  }
});
