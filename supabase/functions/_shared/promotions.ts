import { PublicError, roundMoney } from './core.ts';
import { dbRequest } from './db.ts';

export type CouponQuote = {
  id: string;
  code: string;
  name: string;
  discountType: 'percent' | 'fixed' | 'free_shipping';
  discountValue: number;
  discountAmount: number;
  firstPurchaseOnly: boolean;
  requiresCheckoutValidation: boolean;
};

type CouponCustomer = {
  email?: string;
  document?: string;
};

function normalizedCode(value: unknown) {
  const code = String(value ?? '').trim().toUpperCase();
  if (!code) return '';
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new PublicError('Cupom inválido.');
  return code;
}

async function customerIds(customer: CouponCustomer) {
  const email = String(customer.email || '').trim().toLowerCase();
  const document = String(customer.document || '').replace(/\D/g, '');
  const requests: Promise<any>[] = [];
  if (email) requests.push(dbRequest(`customers?email=ilike.${encodeURIComponent(email)}&select=id`));
  if (document) requests.push(dbRequest(`customers?cpf_cnpj=eq.${encodeURIComponent(document)}&select=id`));
  const rows = (await Promise.all(requests)).flat();
  return Array.from(new Set(rows.map((row: any) => String(row?.id || '')).filter(Boolean)));
}

export async function quoteCoupon(
  rawCode: unknown,
  subtotal: number,
  customer?: CouponCustomer,
): Promise<CouponQuote | null> {
  const code = normalizedCode(rawCode);
  if (!code) return null;

  const rows = await dbRequest(
    `store_coupons?code=eq.${encodeURIComponent(code)}&active=eq.true&select=*&limit=1`,
  );
  const coupon = rows?.[0];
  if (!coupon) throw new PublicError('Cupom inválido ou inativo.');

  const benefitRows = await dbRequest(
    `subscription_benefit_coupons?coupon_id=eq.${encodeURIComponent(coupon.id)}&select=customer_id,subscriptions(status,ends_at)&limit=1`,
  );
  const benefit = benefitRows?.[0] || null;
  if (benefit) {
    const subscription = benefit.subscriptions || {};
    if (subscription.status !== 'active') {
      throw new PublicError('Este benefício exige uma assinatura ativa.');
    }
    if (subscription.ends_at && Date.now() >= new Date(subscription.ends_at).getTime()) {
      throw new PublicError('Este benefício do clube expirou.');
    }
  }

  const now = Date.now();
  if (coupon.starts_at && now < new Date(coupon.starts_at).getTime()) {
    throw new PublicError('Este cupom ainda não está disponível.');
  }
  if (coupon.ends_at && now >= new Date(coupon.ends_at).getTime()) {
    throw new PublicError('Este cupom expirou.');
  }

  const minimumSubtotal = Number(coupon.minimum_subtotal) || 0;
  if (subtotal < minimumSubtotal) {
    const minimum = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minimumSubtotal);
    throw new PublicError(`O valor mínimo deste cupom é ${minimum}.`);
  }

  const redemptions = await dbRequest(
    `store_coupon_redemptions?coupon_id=eq.${encodeURIComponent(coupon.id)}&select=id,customer_id,created_at,orders(payment_status)&limit=1001`,
  );
  const reservationCutoff = Date.now() - 30 * 60 * 1000;
  const activeRedemptions = redemptions.filter((row: any) => {
    const paymentStatus = String(row?.orders?.payment_status || '');
    return paymentStatus === 'pago' || new Date(row?.created_at || 0).getTime() >= reservationCutoff;
  });
  if (coupon.total_usage_limit && activeRedemptions.length >= Number(coupon.total_usage_limit)) {
    throw new PublicError('Este cupom atingiu o limite de utilizações.');
  }

  let requiresCheckoutValidation = Boolean(coupon.first_purchase_only || coupon.per_customer_limit || benefit);
  if (customer) {
    const ids = await customerIds(customer);
    if (benefit && !ids.includes(String(benefit.customer_id))) {
      throw new PublicError('Este cupom é exclusivo do titular da assinatura.');
    }
    if (ids.length) {
      const customerRedemptions = activeRedemptions.filter((row: any) => ids.includes(String(row.customer_id)));
      if (coupon.per_customer_limit && customerRedemptions.length >= Number(coupon.per_customer_limit)) {
        throw new PublicError('Este cupom já foi utilizado por este cliente.');
      }
      if (coupon.first_purchase_only) {
        const paidOrders = await dbRequest(
          `orders?customer_id=in.(${ids.join(',')})&payment_status=eq.pago&select=id&limit=1`,
        );
        if (paidOrders?.length) throw new PublicError('Este cupom é exclusivo para a primeira compra.');
      }
    }
    requiresCheckoutValidation = false;
  }

  const discountType = String(coupon.discount_type) as CouponQuote['discountType'];
  const discountValue = Number(coupon.discount_value) || 0;
  let discountAmount = discountType === 'percent'
    ? roundMoney(subtotal * discountValue / 100)
    : discountType === 'fixed'
      ? Math.min(subtotal, roundMoney(discountValue))
      : 0;
  if (coupon.maximum_discount !== null && coupon.maximum_discount !== undefined) {
    discountAmount = Math.min(discountAmount, Number(coupon.maximum_discount));
  }

  return {
    id: String(coupon.id),
    code,
    name: String(coupon.name || code),
    discountType,
    discountValue,
    discountAmount: roundMoney(Math.max(0, Math.min(subtotal, discountAmount))),
    firstPurchaseOnly: Boolean(coupon.first_purchase_only),
    requiresCheckoutValidation,
  };
}

export function applyCouponToShippingQuotes<T extends { price: number; freeShipping: boolean }>(
  quotes: T[],
  coupon: CouponQuote | null,
): T[] {
  if (!coupon || coupon.discountType !== 'free_shipping' || !quotes.length) return quotes;
  const credit = Math.min(...quotes.map((quote) => Number(quote.price) || 0));
  if (credit <= 0) return quotes;
  return quotes.map((quote) => {
    const price = roundMoney(Math.max(0, Number(quote.price) - credit));
    return { ...quote, price, freeShipping: price === 0 };
  });
}
