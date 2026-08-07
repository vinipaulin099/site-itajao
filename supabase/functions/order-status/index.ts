import { handleOptions, json, parseJson, PublicError, publicErrorResponse } from '../_shared/core.ts';
import { getPublicOrder } from '../_shared/db.ts';

const PAYMENT_LABELS: Record<string, string> = {
  approved: 'Aprovado', pending: 'Pendente', in_process: 'Em análise', rejected: 'Recusado', cancelled: 'Cancelado', refunded: 'Estornado', charged_back: 'Contestado',
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    const body = await parseJson(req);
    const id = String(body?.id || '');
    const token = String(body?.token || '');
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(token)) throw new PublicError('Pedido inválido.', 404);
    const order = await getPublicOrder(id, token);
    if (!order) throw new PublicError('Pedido não encontrado.', 404);
    return json({
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      total: Number(order.total),
      paymentStatus: order.mp_payment_status,
      paymentStatusLabel: PAYMENT_LABELS[order.mp_payment_status] || (order.status === 'awaiting_payment' ? 'Aguardando' : 'Processando'),
      trackingCode: order.tracking_code || null,
    });
  } catch (error) {
    return publicErrorResponse(error);
  }
});

