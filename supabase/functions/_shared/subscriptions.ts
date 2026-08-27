import { dbRequest } from './db.ts';
import { PublicError } from './core.ts';

export type SubscriptionPlanType = 'monthly' | 'annual';
export type SubscriptionCoffeeFormat = 'beans' | 'ground';
export type SubscriptionBillingMethod = 'recurring' | 'pix';

export async function createSubscriptionCheckout(payload: {
  customer: Record<string, unknown>;
  address: Record<string, unknown>;
  planType: SubscriptionPlanType;
  weightGrams: 500 | 1000;
  coffeeFormat: SubscriptionCoffeeFormat;
  billingMethod: SubscriptionBillingMethod;
  clientRequestId: string;
}) {
  const result = await dbRequest('rpc/create_subscription_checkout', {
    method: 'POST',
    body: JSON.stringify({
      p_customer: payload.customer,
      p_address: payload.address,
      p_plan_type: payload.planType,
      p_weight_grams: payload.weightGrams,
      p_coffee_format: payload.coffeeFormat,
      p_billing_method: payload.billingMethod,
      p_client_request_id: payload.clientRequestId,
    }),
  });
  if (!result?.id || !result?.public_token) {
    throw new PublicError('Não foi possível criar a assinatura.', 500);
  }
  return result;
}

export async function getSubscription(id: string) {
  const rows = await dbRequest(
    `subscriptions?id=eq.${encodeURIComponent(id)}&select=*`,
  );
  return rows?.[0] ?? null;
}

export async function findSubscriptionByPreapprovalId(preapprovalId: string) {
  const rows = await dbRequest(
    `subscriptions?mp_preapproval_id=eq.${encodeURIComponent(preapprovalId)}&select=*`,
  );
  return rows?.[0] ?? null;
}

export async function updateSubscription(id: string, payload: Record<string, unknown>) {
  const rows = await dbRequest(`subscriptions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  return rows?.[0] ?? null;
}

export async function recordSubscriptionPayment(payload: {
  subscriptionId: string;
  providerPaymentId: string;
  providerAuthorizedPaymentId?: string | null;
  rawStatus: string;
  amountCents: number;
  paidAt?: string | null;
  paymentMethod?: string | null;
  nextPaymentAt?: string | null;
}) {
  return await dbRequest('rpc/record_subscription_payment', {
    method: 'POST',
    body: JSON.stringify({
      p_subscription_id: payload.subscriptionId,
      p_provider_payment_id: payload.providerPaymentId,
      p_provider_authorized_payment_id: payload.providerAuthorizedPaymentId || null,
      p_raw_status: payload.rawStatus,
      p_amount_cents: payload.amountCents,
      p_paid_at: payload.paidAt || null,
      p_payment_method: payload.paymentMethod || 'unknown',
      p_next_payment_at: payload.nextPaymentAt || null,
    }),
  });
}

export async function logSubscriptionEvent(payload: {
  subscriptionId?: string | null;
  provider: string;
  eventType: string;
  externalId: string;
  ok: boolean;
  detail?: string;
}) {
  try {
    await dbRequest('subscription_events?on_conflict=provider,event_type,external_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        subscription_id: payload.subscriptionId || null,
        provider: payload.provider,
        event_type: payload.eventType,
        external_id: payload.externalId,
        ok: payload.ok,
        detail: String(payload.detail || '').slice(0, 1500) || null,
      }),
    });
  } catch (error) {
    console.error('Subscription event log failed', error);
  }
}

export async function getPublicSubscription(id: string, token: string) {
  const subscriptions = await dbRequest(
    `subscriptions?id=eq.${encodeURIComponent(id)}&public_token=eq.${encodeURIComponent(token)}&select=id,subscription_number,plan_type,weight_grams,coffee_format,billing_method,status,unit_price_cents,billing_cycle_limit,billing_cycles_paid,original_total_cents,discount_bps,discount_cents,total_amount_cents,shipping_amount_cents,mp_status,checkout_url,starts_at,ends_at,next_payment_at,created_at`,
  );
  const subscription = subscriptions?.[0];
  if (!subscription) return null;

  const [payments, shipments, benefitCoupons] = await Promise.all([
    dbRequest(
      `subscription_payments?subscription_id=eq.${encodeURIComponent(id)}&select=cycle_number,status,amount_cents,paid_at&order=cycle_number.desc&limit=12`,
    ),
    dbRequest(
      `subscription_shipments?subscription_id=eq.${encodeURIComponent(id)}&select=shipment_number,status,scheduled_for,reward_code,tracking_code&order=shipment_number.asc&limit=24`,
    ),
    dbRequest(
      `subscription_benefit_coupons?subscription_id=eq.${encodeURIComponent(id)}&select=code&limit=1`,
    ),
  ]);

  return {
    ...subscription,
    payments: payments || [],
    shipments: shipments || [],
    benefit_coupon_code: benefitCoupons?.[0]?.code || null,
  };
}
