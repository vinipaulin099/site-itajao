import { cleanText, PublicError } from './core.ts';
import { dbRequest, logIntegration, updateOrder } from './db.ts';
import { providerToken } from './tokens.ts';

async function blingFetch(path: string, init: RequestInit = {}) {
  const token = await providerToken('bling');
  const response = await fetch(`https://api.bling.com.br/Api/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'enable-jwt': '1',
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Bling API error', path, response.status, data);
    throw new PublicError(`O Bling recusou a sincronização (${response.status}).`, 502);
  }
  return data;
}

async function findOrCreateContact(order: any) {
  if (order.bling_contact_id) return Number(order.bling_contact_id);
  const document = String(order.customer?.document || '').replace(/\D/g, '');
  if (!document) throw new PublicError('Pedido sem CPF/CNPJ para o Bling.', 500);
  const found = await blingFetch(`/contatos?numeroDocumento=${encodeURIComponent(document)}&limite=1`);
  const existing = found?.data?.[0]?.id;
  if (existing) return Number(existing);
  const address = order.delivery_address;
  const customer = order.customer;
  const created = await blingFetch('/contatos', {
    method: 'POST',
    body: JSON.stringify({
      nome: cleanText(customer.name, 120),
      tipo: customer.personType === 'J' ? 'J' : 'F',
      situacao: 'A',
      numeroDocumento: document,
      telefone: customer.phone,
      celular: customer.phone,
      email: customer.email,
      endereco: {
        geral: {
          endereco: address.street,
          cep: address.postalCode,
          bairro: address.district,
          municipio: address.city,
          uf: address.state,
          numero: address.number,
          complemento: address.complement || '',
        },
      },
    }),
  });
  const id = created?.data?.id;
  if (!id) throw new PublicError('O Bling não retornou o ID do contato criado.', 502);
  return Number(id);
}

function exactSkuMatch(data: any, sku: string) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  const match = rows.find((item: any) => String(item?.codigo || '').trim().toUpperCase() === sku.toUpperCase());
  const id = Number(match?.id || 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

async function saveProductBlingId(productId: string, blingId: number) {
  if (!productId) return;
  await dbRequest(`products?id=eq.${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ bling_product_id: blingId, updated_at: new Date().toISOString() }),
  });
}

async function resolveBlingProductId(item: any) {
  const dbId = Number(item?.blingProductId || 0);
  if (Number.isInteger(dbId) && dbId > 0) return dbId;

  const envKey = String(item?.blingEnvKey || '').trim();
  if (envKey) {
    const envId = Number(Deno.env.get(envKey)?.trim() || 0);
    if (Number.isInteger(envId) && envId > 0) return envId;
  }

  const sku = String(item?.sku || '').trim();
  if (!sku) throw new PublicError('Produto do pedido sem SKU para o Bling.', 409);

  try {
    const filtered = await blingFetch(`/produtos?criterio=${encodeURIComponent(sku)}&limite=100`);
    const found = exactSkuMatch(filtered, sku);
    if (found) {
      await saveProductBlingId(String(item.productId || ''), found);
      return found;
    }
  } catch (error) {
    console.warn('Busca direta de produto no Bling indisponível; usando paginação.', sku, error);
  }

  for (let page = 1; page <= 20; page += 1) {
    const listed = await blingFetch(`/produtos?pagina=${page}&limite=100`);
    const rows = Array.isArray(listed?.data) ? listed.data : [];
    const found = exactSkuMatch(listed, sku);
    if (found) {
      await saveProductBlingId(String(item.productId || ''), found);
      return found;
    }
    if (rows.length < 100) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new PublicError(`Produto ${sku} não foi encontrado no Bling. Cadastre o mesmo SKU no Bling antes da sincronização.`, 409);
}

export async function syncOrderToBling(order: any) {
  if (Deno.env.get('MP_USE_SANDBOX') === 'true') {
    throw new PublicError('Sincronização com o Bling bloqueada enquanto o Mercado Pago está no Sandbox.', 409);
  }
  if (order.bling_order_id) return order;

  const contactId = await findOrCreateContact(order);
  const storeOrderNumber = String(order.order_number || order.id || '');
  const items = [];
  for (const item of (order.items || [])) {
    items.push({
      unidade: 'UN',
      quantidade: Number(item.quantity),
      valor: Number(item.unitPrice),
      descricao: String(item.name || '').slice(0, 120),
      produto: { id: await resolveBlingProductId(item) },
    });
  }

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const created = await blingFetch('/pedidos/vendas', {
    method: 'POST',
    body: JSON.stringify({
      data: today,
      numeroLoja: storeOrderNumber.startsWith('SITE-') ? storeOrderNumber : `SITE-${storeOrderNumber}`,
      contato: { id: contactId },
      itens: items,
      transporte: {
        fretePorConta: 0,
        frete: Number(order.shipping_amount),
      },
      observacoes: `Pedido do site Itajaó. Frete: ${order.shipping_carrier || ''} ${order.shipping_service_name || ''}. Mercado Pago: ${order.mp_payment_id || ''}`.trim(),
    }),
  });
  const blingOrderId = created?.data?.id;
  if (!blingOrderId) throw new PublicError('O Bling não retornou o ID do pedido de venda.', 502);
  const updated = await updateOrder(order.id, {
    bling_contact_id: contactId,
    bling_order_id: Number(blingOrderId),
    integration_error: null,
  });
  await logIntegration(order.id, 'bling', 'sales_order_created', true, `Pedido de venda ${blingOrderId} criado.`, String(blingOrderId));
  return updated;
}
