import { env, handleOptions, json, parseJson, PublicError, publicErrorResponse, safeEqual } from '../_shared/core.ts';
import { getOrder, updateOrder } from '../_shared/db.ts';
import { syncOrderToBling } from '../_shared/bling.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    const adminToken = req.headers.get('x-admin-token') || '';
    if (!adminToken || !safeEqual(adminToken, env('ADMIN_SETUP_TOKEN'))) throw new PublicError('Não autorizado.', 401);
    const body = await parseJson(req);
    const id = String(body?.orderId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PublicError('Pedido inválido.');
    const order = await getOrder(id);
    if (!order) throw new PublicError('Pedido não encontrado.', 404);
    if (order.status !== 'paid' && order.status !== 'processing' && order.status !== 'fulfilled') throw new PublicError('O pedido ainda não possui pagamento aprovado.', 409);
    try {
      const synced = await syncOrderToBling(order);
      return json({ ok: true, orderId: order.id, blingOrderId: synced?.bling_order_id || order.bling_order_id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateOrder(order.id, { integration_error: `Bling: ${message}` });
      throw error;
    }
  } catch (error) {
    return publicErrorResponse(error);
  }
});

