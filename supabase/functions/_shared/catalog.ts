import { env, PublicError, roundMoney } from './core.ts';

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  price: number;
  compareAtPrice: number | null;
  weightKg: number;
  weightLabel: string;
  format: string;
  shortDescription: string;
  description: string;
  images: string[];
  legacyUrl: string;
  available: boolean;
  sortOrder: number;
  widthCm: number | null;
  heightCm: number | null;
  lengthCm: number | null;
  packageEnv: string;
  blingEnv: string;
};

export type Catalog = Record<string, CatalogProduct>;
export type CartItem = { id: string; quantity: number };

export const FALLBACK_CATALOG: Catalog = {
  graos500: {
    id: 'graos500', sku: 'ITAJAO-GRAOS-500', name: 'Itajaó Especial 500g em Grãos',
    price: 56.90, compareAtPrice: 62.90, weightKg: 0.5, weightLabel: '500g', format: 'Em Grãos',
    shortDescription: 'Café especial em grãos para moer na hora e aproveitar o máximo de aroma e frescor.',
    description: 'Produzido na Fazenda Itajaó, este lote de 500g em grãos preserva o café inteiro até o preparo e permite ajustar a moagem ao método preferido.',
    images: ['assets/images/products/500graos.png'], legacyUrl: 'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-500g-graos-torra-media-100-arabica-sul-de-minas-itajao/',
    available: true, sortOrder: 10, widthCm: 20, heightCm: 20, lengthCm: 20,
    packageEnv: 'GRAOS500', blingEnv: 'BLING_PRODUCT_GRAOS500_ID',
  },
  moido500: {
    id: 'moido500', sku: 'ITAJAO-MOIDO-500', name: 'Itajaó Especial 500g Moído',
    price: 54.90, compareAtPrice: 60.90, weightKg: 0.5, weightLabel: '500g', format: 'Moído',
    shortDescription: 'A praticidade do café já moído sem abrir mão do perfil especial do Itajaó.',
    description: 'A versão de 500g moída foi pensada para o preparo prático do dia a dia, mantendo notas de chocolate, caramelo e castanha.',
    images: ['assets/images/products/500moido.png'], legacyUrl: 'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-500g-moido-torra-media-100-arabica-sul-de-minas-itajao/',
    available: true, sortOrder: 20, widthCm: 20, heightCm: 20, lengthCm: 20,
    packageEnv: 'MOIDO500', blingEnv: 'BLING_PRODUCT_MOIDO500_ID',
  },
  graos250: {
    id: 'graos250', sku: 'ITAJAO-GRAOS-250', name: 'Itajaó Especial 250g em Grãos',
    price: 31.90, compareAtPrice: 38.90, weightKg: 0.25, weightLabel: '250g', format: 'Em Grãos',
    shortDescription: 'Formato compacto em grãos, ideal para experimentar o lote e moer cada dose na hora.',
    description: 'O pacote de 250g em grãos traz o mesmo lote especial Itajaó em uma quantidade menor e mantém a flexibilidade de moagem.',
    images: ['assets/images/products/250graos.png'], legacyUrl: 'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-250g-graos-torra-media-100-arabica-sul-de-minas-itajao/',
    available: false, sortOrder: 30, widthCm: 20, heightCm: 20, lengthCm: 20,
    packageEnv: 'GRAOS250', blingEnv: 'BLING_PRODUCT_GRAOS250_ID',
  },
  moido250: {
    id: 'moido250', sku: 'ITAJAO-MOIDO-250', name: 'Itajaó Especial 250g Moído',
    price: 29.90, compareAtPrice: 36.90, weightKg: 0.25, weightLabel: '250g', format: 'Moído',
    shortDescription: 'Uma porta de entrada prática para conhecer o Itajaó já moído.',
    description: 'O pacote de 250g moído reúne praticidade, torra média e notas naturais de chocolate, caramelo e castanha.',
    images: ['assets/images/products/250moido.png'], legacyUrl: 'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-250g-moido-torra-media-100-arabica-sul-de-minas-itajao/',
    available: true, sortOrder: 40, widthCm: 20, heightCm: 20, lengthCm: 20,
    packageEnv: 'MOIDO250', blingEnv: 'BLING_PRODUCT_MOIDO250_ID',
  },
  kit1kg: {
    id: 'kit1kg', sku: 'ITAJAO-KIT-1KG', name: 'Kit Itajaó Especial 1kg',
    price: 103.90, compareAtPrice: 104.90, weightKg: 1, weightLabel: '1kg', format: 'Kit · 2×500g',
    shortDescription: 'Dois pacotes de 500g para completar 1kg de Café Especial Itajaó.',
    description: 'O kit de 1kg reúne dois pacotes de 500g do Café Especial Itajaó para quem quer manter o café fresco por mais tempo.',
    images: ['assets/images/products/500graos.png', 'assets/images/products/500moido.png'], legacyUrl: 'https://cafeitajao.com.br/produtos/kit-1kg-cafe-especial-84-pontos-sca-torra-media-100-arabica-sul-de-minas-itajao/',
    available: true, sortOrder: 50, widthCm: 20, heightCm: 20, lengthCm: 20,
    packageEnv: 'KIT1KG', blingEnv: 'BLING_PRODUCT_KIT1KG_ID',
  },
};

// Compatibilidade com integrações que ainda usam a constante síncrona.
export const CATALOG = FALLBACK_CATALOG;

let catalogCache: { value: Catalog; expiresAt: number } | null = null;

function adminKey() {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')?.trim() || '';
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      const key = String(parsed?.default || '').trim();
      if (key) return { key, legacyJwt: false };
    } catch (error) {
      console.error('SUPABASE_SECRET_KEYS inválido ao carregar catálogo', error);
    }
  }
  return { key: env('SUPABASE_SERVICE_ROLE_KEY'), legacyJwt: true };
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function productFromRow(row: any): CatalogProduct | null {
  const id = String(row?.store_key || '').trim();
  const sku = String(row?.sku || '').trim();
  const name = String(row?.name || '').trim();
  const price = Number(row?.sale_price);
  if (!id || !sku || !name || !Number.isFinite(price) || price < 0) return null;
  const images = Array.isArray(row?.store_images)
    ? row.store_images.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const weightGrams = Number(row?.weight_grams) || 0;
  return {
    id,
    sku,
    name,
    price: roundMoney(price),
    compareAtPrice: positiveNumber(row?.compare_at_price),
    weightKg: weightGrams > 0 ? weightGrams / 1000 : 0.5,
    weightLabel: weightGrams >= 1000 ? `${weightGrams / 1000}kg` : `${weightGrams || 500}g`,
    format: String(row?.store_format || ''),
    shortDescription: String(row?.store_short_description || ''),
    description: String(row?.store_description || ''),
    images: images.length ? images : ['assets/images/products/500graos.png'],
    legacyUrl: String(row?.store_legacy_url || 'https://cafeitajao.com.br/'),
    available: Boolean(row?.active),
    sortOrder: Number(row?.store_sort_order) || 0,
    widthCm: positiveNumber(row?.shipping_width_cm),
    heightCm: positiveNumber(row?.shipping_height_cm),
    lengthCm: positiveNumber(row?.shipping_length_cm),
    packageEnv: String(row?.package_env_key || id.toUpperCase()),
    blingEnv: String(row?.bling_env_key || ''),
  };
}

export async function loadCatalog(): Promise<Catalog> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.value;
  try {
    const auth = adminKey();
    const select = [
      'store_key', 'sku', 'name', 'weight_grams', 'sale_price', 'active',
      'store_visible', 'store_sort_order', 'compare_at_price', 'store_format',
      'store_short_description', 'store_description', 'store_images',
      'store_legacy_url', 'shipping_width_cm', 'shipping_height_cm',
      'shipping_length_cm', 'package_env_key', 'bling_env_key',
    ].join(',');
    const response = await fetch(
      `${env('SUPABASE_URL')}/rest/v1/products?store_key=not.is.null&store_visible=eq.true&select=${select}&order=store_sort_order.asc`,
      {
        headers: {
          apikey: auth.key,
          ...(auth.legacyJwt ? { Authorization: `Bearer ${auth.key}` } : {}),
          Accept: 'application/json',
        },
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data)) {
      console.error('Catálogo do banco indisponível; usando catálogo seguro local.', response.status, data);
      return FALLBACK_CATALOG;
    }
    const products = data.map(productFromRow).filter(Boolean) as CatalogProduct[];
    if (!products.length) return FALLBACK_CATALOG;
    const value = Object.fromEntries(products.map((product) => [product.id, product]));
    catalogCache = { value, expiresAt: Date.now() + 30_000 };
    return value;
  } catch (error) {
    console.error('Falha ao carregar catálogo; usando catálogo seguro local.', error);
    return FALLBACK_CATALOG;
  }
}

export function publicCatalog(catalog: Catalog) {
  return Object.values(catalog)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      weightLabel: product.weightLabel,
      format: product.format,
      shortDescription: product.shortDescription,
      description: product.description,
      images: product.images,
      legacyUrl: product.legacyUrl,
      available: product.available,
    }));
}

export function validateCart(input: unknown, catalog: Catalog = FALLBACK_CATALOG): CartItem[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) throw new PublicError('Carrinho inválido.');
  const merged = new Map<string, number>();
  for (const raw of input) {
    const id = String(raw?.id ?? '');
    const quantity = Number(raw?.quantity);
    const product = catalog[id];
    if (!product || !product.available) throw new PublicError('Um dos produtos não está disponível no momento.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new PublicError('Quantidade de produto inválida.');
    merged.set(id, (merged.get(id) || 0) + quantity);
  }
  const items = Array.from(merged, ([id, quantity]) => ({ id, quantity }));
  if (items.some((item) => item.quantity > 10)) throw new PublicError('Quantidade de produto inválida.');
  if (items.reduce((sum, item) => sum + item.quantity, 0) > 20) throw new PublicError('O carrinho excede o limite de unidades por pedido.');
  return items;
}

export function cartSubtotal(items: CartItem[], catalog: Catalog = FALLBACK_CATALOG) {
  return roundMoney(items.reduce((sum, item) => sum + catalog[item.id].price * item.quantity, 0));
}

function dimension(product: CatalogProduct, field: 'WIDTH' | 'HEIGHT' | 'LENGTH') {
  const databaseValue = field === 'WIDTH' ? product.widthCm : field === 'HEIGHT' ? product.heightCm : product.lengthCm;
  if (databaseValue) return databaseValue;
  const key = `PACK_${product.packageEnv}_${field}_CM`;
  const value = Number(env(key));
  if (!Number.isFinite(value) || value <= 0) throw new PublicError(`Dimensão de embalagem inválida no servidor: ${key}.`, 503);
  return value;
}

export function melhorEnvioProducts(items: CartItem[], catalog: Catalog = FALLBACK_CATALOG) {
  return items.map((item) => {
    const product = catalog[item.id];
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
  const product = FALLBACK_CATALOG[productId];
  if (!product) throw new PublicError('Mapeamento de produto inválido.', 500);
  const value = Number(env(product.blingEnv));
  if (!Number.isInteger(value) || value <= 0) throw new PublicError(`Mapeamento do Bling pendente: ${product.blingEnv}.`, 503);
  return value;
}

export function catalogIdFromSku(sku: string) {
  const entry = Object.values(FALLBACK_CATALOG).find((product) => product.sku === sku);
  if (!entry) throw new PublicError(`SKU do CRM sem mapeamento no checkout: ${sku}.`, 500);
  return entry.id;
}

export function orderItemsSnapshot(items: CartItem[], catalog: Catalog = FALLBACK_CATALOG) {
  return items.map((item) => ({
    id: item.id,
    sku: catalog[item.id].sku,
    name: catalog[item.id].name,
    weightGrams: Math.round(catalog[item.id].weightKg * 1000),
    quantity: item.quantity,
    unitPrice: catalog[item.id].price,
  }));
}
