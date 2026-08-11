import { cartSubtotal, loadCatalog, validateCart } from '../_shared/catalog.ts';
import { commerceEnabled, handleOptions, json, parseJson, publicErrorResponse } from '../_shared/core.ts';
import { quoteCoupon } from '../_shared/promotions.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    commerceEnabled();
    const body = await parseJson(req);
    const catalog = await loadCatalog();
    const items = validateCart(body?.items, catalog);
    const subtotal = cartSubtotal(items, catalog);
    const coupon = await quoteCoupon(body?.couponCode, subtotal);
    return json({
      subtotal,
      discountAmount: coupon?.discountAmount || 0,
      totalBeforeShipping: subtotal - (coupon?.discountAmount || 0),
      coupon: coupon ? {
        code: coupon.code,
        name: coupon.name,
        discountType: coupon.discountType,
        discountAmount: coupon.discountAmount,
        firstPurchaseOnly: coupon.firstPurchaseOnly,
        requiresCheckoutValidation: coupon.requiresCheckoutValidation,
      } : null,
    });
  } catch (error) {
    return publicErrorResponse(error);
  }
});
