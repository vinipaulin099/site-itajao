import { Catalog, CartItem, FALLBACK_CATALOG, cartSubtotal, melhorEnvioProducts } from './catalog.ts';
import { env, PublicError, roundMoney } from './core.ts';
import { melhorEnvioBaseUrl, providerToken } from './tokens.ts';
import { lookupCep } from './validation.ts';

export type ShippingQuote = {
  id: number;
  name: string;
  company: string;
  price: number;
  cost: number;
  deliveryTime: number | null;
  freeShipping: boolean;
  raw: any;
};

export type ShippingPackageOverride = {
  width: number;
  height: number;
  length: number;
  weight: number;
};

export async function fetchShippingQuotes(
  postalCode: string,
  items: CartItem[],
  options: { catalog?: Catalog; packageOverride?: ShippingPackageOverride } = {},
) {
  const catalog = options.catalog || FALLBACK_CATALOG;
  const packageOverride = options.packageOverride;
  const token = await providerToken('melhorenvio');
  const products = packageOverride
    ? [{
        id: 'ITAJAO-SHIPPING-TEST',
        width: packageOverride.width,
        height: packageOverride.height,
        length: packageOverride.length,
        weight: packageOverride.weight,
        insurance_value: cartSubtotal(items, catalog),
        quantity: 1,
      }]
    : melhorEnvioProducts(items, catalog);
  const body = {
    from: { postal_code: env('SHIP_FROM_POSTAL_CODE').replace(/\D/g, '') },
    to: { postal_code: postalCode },
    products,
    options: { receipt: false, own_hand: false },
  };
  const response = await fetch(`${melhorEnvioBaseUrl()}/api/v2/me/shipment/calculate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': env('ME_USER_AGENT'),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data)) {
    console.error('Melhor Envio quote error', response.status, data);
    throw new PublicError('Não foi possível calcular o frete agora. Tente novamente em instantes.', 502);
  }
  const destination = await lookupCep(postalCode);
  const subtotal = cartSubtotal(items, catalog);
  const freeThreshold = destination?.state && ['SP', 'MG', 'RJ', 'ES'].includes(destination.state) ? 249.90 : 399.90;
  const freeEligible = subtotal >= freeThreshold;

  const baseQuotes: ShippingQuote[] = data
    .filter((quote: any) => quote && !quote.error && Number.isFinite(Number(quote.custom_price ?? quote.price)))
    .map((quote: any) => {
      const cost = roundMoney(Number(quote.custom_price ?? quote.price));
      return {
        id: Number(quote.id),
        name: String(quote.name || 'Entrega'),
        company: String(quote.company?.name || ''),
        price: cost,
        cost,
        deliveryTime: Number(quote.custom_delivery_time ?? quote.delivery_time) || null,
        freeShipping: false,
        raw: quote,
      };
    })
    .filter((quote: ShippingQuote) => Number.isInteger(quote.id) && quote.id > 0 && quote.cost >= 0);

  const freeShippingCredit = freeEligible && baseQuotes.length
    ? Math.min(...baseQuotes.map((quote) => quote.cost))
    : 0;

  const quotes: ShippingQuote[] = baseQuotes
    .map((quote) => {
      if (!freeEligible) return quote;
      const price = roundMoney(Math.max(0, quote.cost - freeShippingCredit));
      return {
        ...quote,
        price,
        freeShipping: price === 0,
      };
    })
    .sort((a: ShippingQuote, b: ShippingQuote) => a.price - b.price || (a.deliveryTime || 999) - (b.deliveryTime || 999));

  return { quotes, subtotal, freeEligible, freeThreshold, destination };
}

export function publicShippingQuote(quote: ShippingQuote) {
  return {
    id: quote.id,
    name: quote.name,
    company: quote.company,
    price: quote.price,
    originalPrice: quote.cost,
    deliveryTime: quote.deliveryTime,
    freeShipping: quote.freeShipping,
  };
}
