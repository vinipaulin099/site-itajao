import { commerceEnabled, handleOptions, json, parseJson, PublicError, publicErrorResponse, safeEqual } from '../_shared/core.ts';
import { validateCart } from '../_shared/catalog.ts';
import { fetchShippingQuotes, publicShippingQuote, ShippingPackageOverride } from '../_shared/shipping.ts';
import { validatePostalCode } from '../_shared/validation.ts';

function isProtectedShippingTest(req: Request) {
  if (Deno.env.get('COMMERCE_ENABLED') === 'true') return false;
  const received = req.headers.get('x-admin-token') || '';
  const expected = Deno.env.get('ADMIN_SETUP_TOKEN')?.trim() || '';
  return Boolean(received && expected) && safeEqual(received, expected);
}

function validateTestPackage(raw: any): ShippingPackageOverride {
  const result = {
    width: Number(raw?.width),
    height: Number(raw?.height),
    length: Number(raw?.length),
    weight: Number(raw?.weight),
  };
  if (![result.width, result.height, result.length].every((value) => Number.isFinite(value) && value >= 1 && value <= 200)) {
    throw new PublicError('Dimensões da embalagem de teste inválidas.');
  }
  if (!Number.isFinite(result.weight) || result.weight <= 0 || result.weight > 30) {
    throw new PublicError('Peso da embalagem de teste inválido.');
  }
  return result;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    const protectedTest = isProtectedShippingTest(req);
    if (!protectedTest) commerceEnabled();
    const body = await parseJson(req);
    const postalCode = validatePostalCode(body?.postalCode);
    const items = validateCart(body?.items);
    const packageOverride = protectedTest && body?.testPackage ? validateTestPackage(body.testPackage) : undefined;
    const result = await fetchShippingQuotes(postalCode, items, packageOverride);
    return json({
      subtotal: result.subtotal,
      freeShippingEligible: result.freeEligible,
      ...(protectedTest && packageOverride ? { testPackage: packageOverride } : {}),
      quotes: result.quotes.map(publicShippingQuote),
    });
  } catch (error) {
    return publicErrorResponse(error);
  }
});
