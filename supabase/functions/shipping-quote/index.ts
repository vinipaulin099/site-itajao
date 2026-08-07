import { commerceEnabled, handleOptions, json, parseJson, publicErrorResponse } from '../_shared/core.ts';
import { validateCart } from '../_shared/catalog.ts';
import { fetchShippingQuotes, publicShippingQuote } from '../_shared/shipping.ts';
import { validatePostalCode } from '../_shared/validation.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    commerceEnabled();
    const body = await parseJson(req);
    const postalCode = validatePostalCode(body?.postalCode);
    const items = validateCart(body?.items);
    const result = await fetchShippingQuotes(postalCode, items);
    return json({
      subtotal: result.subtotal,
      freeShippingEligible: result.freeEligible,
      quotes: result.quotes.map(publicShippingQuote),
    });
  } catch (error) {
    return publicErrorResponse(error);
  }
});

