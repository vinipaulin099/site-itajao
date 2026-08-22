import { env, hmacHex, json, PublicError, publicErrorResponse, safeEqual } from '../_shared/core.ts';
import {
  findSubscriptionByPreapprovalId,
  getSubscription,
  logSubscriptionEvent,
  recordSubscriptionPayment,
  updateSubscription,
} from '../_shared/subscriptions.ts';
import { enqueueEmail } from '../_shared/email.ts';

function publicStatusUrl(subscription: any) {
  const base = env('SITE_URL').replace(/\/+$/, '');
  const url = new URL(`${base}/assinatura-status.html`);
  url.searchParams.set('subscription', subscription.id);
  url.searchParams.set('token', subscription.public_token);
  return url.toString();
}

async function verifySignature(req: Request, url: URL, bodyDataId: string) {
  const header = req.headers.get('x-signature') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const parts = Object.fromEntries(
    header.split(',').map((part) => part.trim().split('=', 2)).filter((part) => part.length === 2),
  );
  const ts = parts.ts || '';
  const received = parts.v1 || '';
  if (!ts || !received) return false;
  const dataId = String(url.searchParams.get('data.id') || bodyDataId || '').toLowerCase();
  let manifest = '';
  if (dataId) manifest += `id:${dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const expected = await hmacHex(env('MP_WEBHOOK_SECRET'), manifest);
  return safeEqual(expected, received);
}

async function mercadoPagoGet(path: string) {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    headers: { Authorization: `Bearer ${env('MP_ACCESS_TOKEN')}`, Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Mercado Pago subscription lookup error', response.status, path, data);
    throw new PublicError('Não foi possível validar a assinatura no Mercado Pago.', 502);
  }
  return data;
}

function paymentMethod(payment: any) {
  const method = String(payment?.payment_method_id || '').toLowerCase();
  const type = String(payment?.payment_type_id || '').toLowerCase();
  if (method === 'pix') return 'pix';
  if (type === 'credit_card') return 'cartao_credito';
  if (type === 'debit_card') return 'cartao_debito';
  return method || type || 'unknown';
}

async function processPayment(payment: any, authorizedPaymentId = '') {
  const subscriptionId = String(payment?.external_reference || '');
  if (!subscriptionId) return null;
  const subscription = await getSubscription(subscriptionId);
  if (!subscription) return null;
  if (payment.currency_id !== 'BRL') {
    await logSubscriptionEvent({
      subscriptionId,
      provider: 'mercadopago',
      eventType: 'payment_currency_mismatch',
      externalId: String(payment.id || authorizedPaymentId),
      ok: false,
      detail: `Moeda recebida: ${String(payment.currency_id || 'não informada')}.`,
    });
    throw new PublicError('Moeda inválida para a assinatura.', 409);
  }

  let nextPaymentAt: string | null = null;
  if (subscription.mp_preapproval_id) {
    const preapproval = await mercadoPagoGet(
      `/preapproval/${encodeURIComponent(subscription.mp_preapproval_id)}`,
    );
    nextPaymentAt = preapproval?.next_payment_date || null;
    await updateSubscription(subscription.id, {
      mp_status: String(preapproval?.status || payment.status || ''),
      next_payment_at: nextPaymentAt,
    });
  }

  const result = await recordSubscriptionPayment({
    subscriptionId: subscription.id,
    providerPaymentId: String(payment.id),
    providerAuthorizedPaymentId: authorizedPaymentId || null,
    rawStatus: String(payment.status || 'pending'),
    amountCents: Math.round(Number(payment.transaction_amount || 0) * 100),
    paidAt: payment.date_approved || payment.date_created || null,
    paymentMethod: paymentMethod(payment),
    nextPaymentAt,
  });

  await logSubscriptionEvent({
    subscriptionId: subscription.id,
    provider: 'mercadopago',
    eventType: `payment_${String(payment.status || 'updated')}`,
    externalId: String(payment.id),
    ok: true,
    detail: `Pagamento ${payment.id} processado no ciclo ${result?.cycle_number || '?'}.`,
  });

  if (result?.became_paid) {
    const customer = subscription.customer_snapshot || {};
    try {
      await enqueueEmail({
        category: 'transactional',
        templateKey: 'subscription_payment_approved',
        recipientEmail: String(customer.email || ''),
        recipientName: String(customer.name || ''),
        senderKind: 'customer',
        subject: `Pagamento confirmado · ${subscription.subscription_number}`,
        payload: {
          customer_name: customer.name,
          subscription_id: subscription.id,
          subscription_number: subscription.subscription_number,
          public_token: subscription.public_token,
          subscription_url: publicStatusUrl(subscription),
          payment_amount: Number(payment.transaction_amount || 0),
          benefit_code: result.benefit_coupon_code || null,
        },
        idempotencyKey: `subscription:${subscription.id}:payment:${payment.id}:approved`,
        relatedCustomerId: subscription.customer_id,
        resourceType: 'subscription',
        resourceId: subscription.id,
        priority: 10,
      });
    } catch (emailError) {
      console.error('Subscription payment email queue failed', subscription.id, emailError);
    }
  }

  if (result?.should_stop_recurring && subscription.mp_preapproval_id) {
    const response = await fetch(
      `https://api.mercadopago.com/preapproval/${encodeURIComponent(subscription.mp_preapproval_id)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${env('MP_ACCESS_TOKEN')}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ status: 'canceled' }),
      },
    );
    const cancellation = await response.json().catch(() => ({}));
    if (!response.ok) {
      await logSubscriptionEvent({
        subscriptionId: subscription.id,
        provider: 'mercadopago',
        eventType: 'annual_recurring_stop',
        externalId: subscription.mp_preapproval_id,
        ok: false,
        detail: String(cancellation?.message || `Mercado Pago ${response.status}`),
      });
      throw new PublicError('Não foi possível encerrar a cobrança após o 12º ciclo.', 502);
    }
    await updateSubscription(subscription.id, {
      mp_status: 'canceled_after_12_payments',
      next_payment_at: null,
    });
    await logSubscriptionEvent({
      subscriptionId: subscription.id,
      provider: 'mercadopago',
      eventType: 'annual_recurring_stop',
      externalId: subscription.mp_preapproval_id,
      ok: true,
      detail: 'Cobrança recorrente encerrada após os 12 pagamentos contratados.',
    });
  }

  return { subscription, result };
}

async function processPreapproval(preapprovalId: string) {
  const preapproval = await mercadoPagoGet(`/preapproval/${encodeURIComponent(preapprovalId)}`);
  const externalReference = String(preapproval?.external_reference || '');
  const subscription = externalReference
    ? await getSubscription(externalReference)
    : await findSubscriptionByPreapprovalId(preapprovalId);
  if (!subscription) return null;
  if (subscription.mp_preapproval_id && subscription.mp_preapproval_id !== preapprovalId) {
    throw new PublicError('Identificador de recorrência divergente.', 409);
  }

  const mpStatus = String(preapproval?.status || '');
  let localStatus = subscription.status;
  if (mpStatus === 'paused') localStatus = 'paused';
  if (['cancelled', 'canceled'].includes(mpStatus)) {
    const annualCycleCompleted = subscription.plan_type === 'annual'
      && Number(subscription.billing_cycles_paid || 0) >= 12;
    if (annualCycleCompleted) {
      const ended = subscription.ends_at && Date.now() >= new Date(subscription.ends_at).getTime();
      localStatus = ended ? 'completed' : 'active';
    } else {
      localStatus = 'cancelled';
    }
  }

  await updateSubscription(subscription.id, {
    mp_preapproval_id: preapprovalId,
    mp_status: mpStatus,
    status: localStatus,
    next_payment_at: preapproval?.next_payment_date || null,
  });
  await logSubscriptionEvent({
    subscriptionId: subscription.id,
    provider: 'mercadopago',
    eventType: `preapproval_${mpStatus || 'updated'}`,
    externalId: preapprovalId,
    ok: true,
    detail: `Pré-aprovação ${preapprovalId} atualizada para ${mpStatus || 'sem status'}.`,
  });
  return subscription;
}

async function processAuthorizedPayment(authorizedPaymentId: string) {
  const invoice = await mercadoPagoGet(
    `/authorized_payments/${encodeURIComponent(authorizedPaymentId)}`,
  );
  const paymentId = String(invoice?.payment?.id || '');
  if (!paymentId) {
    const subscription = invoice?.preapproval_id
      ? await findSubscriptionByPreapprovalId(String(invoice.preapproval_id))
      : null;
    if (subscription) {
      await logSubscriptionEvent({
        subscriptionId: subscription.id,
        provider: 'mercadopago',
        eventType: 'authorized_payment_pending',
        externalId: authorizedPaymentId,
        ok: true,
        detail: `Fatura recorrente em ${String(invoice?.summarized || invoice?.status || 'processamento')}.`,
      });
    }
    return null;
  }
  const payment = await mercadoPagoGet(`/v1/payments/${encodeURIComponent(paymentId)}`);
  return await processPayment(payment, authorizedPaymentId);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true });
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const dataId = String(url.searchParams.get('data.id') || body?.data?.id || '');
    if (!(await verifySignature(req, url, dataId))) {
      throw new PublicError('Assinatura inválida.', 401);
    }
    if (!dataId) return json({ ok: true });

    const topic = String(
      url.searchParams.get('type')
      || url.searchParams.get('topic')
      || body?.type
      || '',
    );

    if (topic === 'payment') {
      const payment = await mercadoPagoGet(`/v1/payments/${encodeURIComponent(dataId)}`);
      await processPayment(payment);
    } else if (topic === 'subscription_preapproval') {
      await processPreapproval(dataId);
    } else if (topic === 'subscription_authorized_payment') {
      await processAuthorizedPayment(dataId);
    }

    return json({ ok: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
});
