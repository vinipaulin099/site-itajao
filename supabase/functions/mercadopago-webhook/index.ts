import { env, hmacHex, json, PublicError, publicErrorResponse, safeEqual } from '../_shared/core.ts';
import { getOrder, logIntegration, recordPayment, updateOrder } from '../_shared/db.ts';
import { syncOrderToBling } from '../_shared/bling.ts';

async function verifySignature(req: Request, url: URL) {
  const header = req.headers.get('x-signature') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const parts = Object.fromEntries(header.split(',').map((part) => part.trim().split('=', 2)).filter((part) => part.length === 2));
  const ts = parts.ts || '';
  const received = parts.v1 || '';
  if (!ts || !received) return false;
  const dataId = (url.searchParams.get('data.id') || '').toLowerCase();
  let manifest = '';
  if (dataId) manifest += `id:${dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const expected = await hmacHex(env('MP_WEBHOOK_SECRET'), manifest);
  return safeEqual(expected, received);
}

function localStatus(mpStatus: string) {
  if (mpStatus === 'approved') return 'paid';
  if (['rejected', 'cancelled'].includes(mpStatus)) return 'payment_failed';
  if (['refunded', 'charged_back'].includes(mpStatus)) return 'refunded';
  return 'awaiting_payment';
}

function crmPaymentMethod(payment: any) {
  const methodId = String(payment?.payment_method_id || '').toLowerCase();
  const typeId = String(payment?.payment_type_id || '').toLowerCase();
  if (methodId === 'pix') return 'pix';
  if (typeId === 'credit_card') return 'cartao_credito';
  if (typeId === 'debit_card') return 'cartao_debito';
  if (typeId === 'ticket') return 'boleto';
  if (typeId === 'bank_transfer') return 'transferencia';
  return 'outro';
}

function crmPaymentStatus(mpStatus: string): 'pendente' | 'pago' | 'cancelado' | 'reembolsado' {
  if (mpStatus === 'approved') return 'pago';
  if (['refunded', 'charged_back'].includes(mpStatus)) return 'reembolsado';
  if (['rejected', 'cancelled'].includes(mpStatus)) return 'cancelado';
  return 'pendente';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true });
  try {
    const url = new URL(req.url);
    if (!(await verifySignature(req, url))) throw new PublicError('Assinatura inválida.', 401);
    const body = await req.json().catch(() => ({}));
    const topic = String(url.searchParams.get('type') || body?.type || '');
    if (topic && topic !== 'payment') return json({ ok: true });
    const paymentId = String(url.searchParams.get('data.id') || body?.data?.id || '');
    if (!paymentId) return json({ ok: true });

    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${env('MP_ACCESS_TOKEN')}`, Accept: 'application/json' },
    });
    const payment = await mpResponse.json().catch(() => ({}));
    if (!mpResponse.ok) throw new PublicError('Não foi possível validar o pagamento no Mercado Pago.', 502);
    const orderId = String(payment.external_reference || '');
    const order = await getOrder(orderId);
    if (!order) throw new PublicError('Pedido não localizado para este pagamento.', 404);
    const amountMatches = Math.abs(Number(payment.transaction_amount) - Number(order.total)) < 0.01;
    if (payment.currency_id !== 'BRL' || !amountMatches) {
      const detail = `Pagamento ${paymentId} diverge do pedido: ${payment.currency_id} ${payment.transaction_amount} / esperado BRL ${order.total}`;
      await updateOrder(order.id, { mp_payment_id: paymentId, mp_payment_status: String(payment.status || ''), integration_error: detail });
      await logIntegration(order.id, 'mercadopago', 'payment_amount_mismatch', false, detail, paymentId);
      return json({ ok: true });
    }
    const updated = await updateOrder(order.id, {
      checkout_status: localStatus(String(payment.status || '')),
      mp_payment_id: paymentId,
      mp_payment_status: String(payment.status || ''),
      integration_error: null,
    });
    await logIntegration(order.id, 'mercadopago', `payment_${String(payment.status || 'updated')}`, true, `Pagamento ${paymentId}: ${payment.status}`, paymentId);

    const crmStatus = crmPaymentStatus(String(payment.status || ''));
    await recordPayment(order.id, {
      amount: Number(payment.transaction_amount),
      method: crmPaymentMethod(payment),
      status: crmStatus,
      paidAt: crmStatus === 'pago'
        ? String(payment.date_approved || payment.date_created || new Date().toISOString())
        : null,
      externalReference: paymentId,
      notes: `Mercado Pago · status ${String(payment.status || 'não informado')} · tipo ${String(payment.payment_type_id || 'não informado')} · método ${String(payment.payment_method_id || 'não informado')}`,
    });
    await logIntegration(order.id, 'crm', 'payment_registered', true, `Pagamento ${paymentId} registrado no CRM como ${crmStatus}.`, paymentId);

    if (payment.status === 'approved' && !updated?.bling_order_id) {
      if (Deno.env.get('MP_USE_SANDBOX') === 'true') {
        await logIntegration(
          order.id,
          'bling',
          'sales_order_skipped_sandbox',
          true,
          'Sincronização com o Bling ignorada porque o Mercado Pago está no Sandbox.',
        );
      } else {
        try {
          await syncOrderToBling(updated);
        } catch (syncError) {
          const message = syncError instanceof Error ? syncError.message : String(syncError);
          await updateOrder(order.id, { integration_error: `Bling: ${message}` });
          await logIntegration(order.id, 'bling', 'sales_order_sync', false, message);
          console.error('Bling sync failed', order.id, syncError);
        }
      }
    }
    return json({ ok: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
});
