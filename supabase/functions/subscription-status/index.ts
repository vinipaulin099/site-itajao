import { handleOptions, json, parseJson, PublicError, publicErrorResponse } from '../_shared/core.ts';
import { getPublicSubscription } from '../_shared/subscriptions.ts';

const STATUS_LABELS: Record<string, string> = {
  checkout_pending: 'Aguardando pagamento',
  active: 'Assinatura ativa',
  past_due: 'Pagamento pendente',
  paused: 'Assinatura pausada',
  completed: 'Ciclo concluído',
  cancelled: 'Assinatura cancelada',
  checkout_error: 'Pagamento não iniciado',
  refunded: 'Pagamento estornado',
};

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    const body = await parseJson(req);
    const id = String(body?.id || '').trim();
    const token = String(body?.token || '').trim();
    if (!validUuid(id) || !validUuid(token)) throw new PublicError('Assinatura inválida.', 404);

    const subscription = await getPublicSubscription(id, token);
    if (!subscription) throw new PublicError('Assinatura não encontrada.', 404);
    const effectiveStatus = subscription.status === 'active'
      && subscription.ends_at
      && Date.now() >= new Date(subscription.ends_at).getTime()
      ? 'completed'
      : subscription.status;

    return json({
      id: subscription.id,
      subscriptionNumber: subscription.subscription_number,
      planType: subscription.plan_type,
      weightGrams: subscription.weight_grams,
      coffeeFormat: subscription.coffee_format,
      billingMethod: subscription.billing_method,
      status: effectiveStatus,
      statusLabel: STATUS_LABELS[effectiveStatus] || 'Em processamento',
      billingCyclesPaid: subscription.billing_cycles_paid,
      billingCycleLimit: subscription.billing_cycle_limit,
      unitPriceCents: subscription.unit_price_cents,
      originalTotalCents: subscription.original_total_cents,
      discountBps: subscription.discount_bps,
      discountCents: subscription.discount_cents,
      totalAmountCents: subscription.total_amount_cents,
      shippingAmountCents: 0,
      benefitCode: effectiveStatus === 'active' ? subscription.benefit_coupon_code : null,
      nextPaymentAt: subscription.next_payment_at,
      payments: subscription.payments,
      shipments: subscription.shipments,
    });
  } catch (error) {
    return publicErrorResponse(error);
  }
});
