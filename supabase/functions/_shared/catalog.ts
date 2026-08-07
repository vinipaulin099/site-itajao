import { env, PublicError, roundMoney } from './core.ts';

type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  price: number;
  weightKg: number;
  available: boolean;
  packageEnv: string;
  blingEnv: string;
};

export type CartItem = { id: string; quantity: number };

export const CATALOG: Record<string, CatalogProduct> = {
  graos500: { id: 'graos500', sku: 'ITAJAO-GRAOS-500', name: 'Itajaó Especial 500g em Grãos', price: 56.90, weightKg: 0.5, available: true, packageEnv: 'GRAOS500', blingEnv: 'BLING_PRODUCT_GRAOS500_ID' },
  moido500: { id: 'moido500', sku: 'ITAJAO-MOIDO-500', name: 'Itajaó Especial 500g Moído', price: 54.90, weightKg: 0.5, available: true, packageEnv: 'MOIDO500', blingEnv: 'BLING_PRODUCT_MOIDO500_ID' },
  graos250: { id: 'graos250', sku: 'ITAJAO-GRAOS-250', name: 'Itajaó Especial 250g em Grãos', price: 31.90, weightKg: 0.25, available: false, packageEnv: 'GRAOS250', blingEnv: 'BLING_PRODUCT_GRAOS250_ID' },
  moido250: { id: 'moido250', sku: 'ITAJAO-MOIDO-250', name: 'Itajaó Especial 250g Moído', price: 29.90, weightKg: 0.25, available: true, packageEnv: 'MOIDO250', blingEnv: 'BLING_PRODUCT_MOIDO250_ID' },
  kit1kg: { id: 'kit1kg', sku: 'ITAJAO-KIT-1KG', name: 'Kit Itajaó Especial 1kg', price: 103.90, weightKg: 1, available: true, packageEnv: 'KIT1KG', blingEnv: 'BLING_PRODUCT_KIT1KG_ID' },
};

export function validateCart(input: unknown): CartItem[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) throw new PublicError('Carrinho inválido.');
  const merged = new Map<string, number>();
  for (const raw of input) {
    const id = String(raw?.id ?? '');
    const quantity = Number(raw?.quantity);
    const product = CATALOG[id];
    if (!product || !product.available) throw new PublicError('Um dos produtos não está disponível no momento.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new PublicError('Quantidade de produto inválida.');
    merged.set(id, (merged.get(id) || 0) + quantity);
  }
  const items = Array.from(merged, ([id, quantity]) => ({ id, quantity }));
  if (items.reduce((sum, item) => sum + item.quantity, 0) > 20) throw new PublicError('O carrinho excede o limite de unidades por pedido.');
  return items;
}

export function cartSubtotal(items: CartItem[]) {
  return roundMoney(items.reduce((sum, item) => sum + CATALOG[item.id].price * item.quantity, 0));
}

function dimension(product: CatalogProduct, field: 'WIDTH' | 'HEIGHT' | 'LENGTH') {
  const key = `PACK_${product.packageEnv}_${field}_CM`;
  const value = Number(env(key));
  if (!Number.isFinite(value) || value <= 0) throw new PublicError(`Dimensão de embalagem inválida no servidor: ${key}.`, 503);
  return value;
}

export function melhorEnvioProducts(items: CartItem[]) {
  return items.map((item) => {
    const product = CATALOG[item.id];
    return {
      id: product.sku,
      width: dimension(product, 'WIDTH'),
      height: dimension(product, 'HEIGHT'),
      length: dimension(product, 'LENGTH'),
      weight: product.weightKg,
      insurance_value: product.price,
      quantity: item.quantity,
    };
  });
}

export function blingProductId(productId: string) {
  const product = CATALOG[productId];
  if (!product) throw new PublicError('Mapeamento de produto inválido.', 500);
  const value = Number(env(product.blingEnv));
  if (!Number.isInteger(value) || value <= 0) throw new PublicError(`Mapeamento do Bling pendente: ${product.blingEnv}.`, 503);
  return value;
}
export function catalogIdFromSku(sku: string) {
  const entry = Object.values(CATALOG).find((product) => product.sku === sku);
  if (!entry) throw new PublicError(`SKU do CRM sem mapeamento no checkout: ${sku}.`, 500);
  return entry.id;
}
export function orderItemsSnapshot(items: CartItem[]) {
  return items.map((item) => ({ id: item.id, sku: CATALOG[item.id].sku, name: CATALOG[item.id].name, quantity: item.quantity, unitPrice: CATALOG[item.id].price }));
}

