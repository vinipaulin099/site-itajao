import { adminClient } from '../_shared/community.ts';
import { json } from '../_shared/core.ts';
import { enqueueEmail } from '../_shared/email.ts';

const TIMEZONE = 'America/Sao_Paulo';

function zonedTimeToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(guess);
  const part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
  const intended = Date.UTC(year, month - 1, day, hour, minute, second);
  const observed = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return new Date(guess.getTime() + intended - observed);
}

function previousMonthRange() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const currentYear = Number(parts.find((value) => value.type === 'year')?.value);
  const currentMonth = Number(parts.find((value) => value.type === 'month')?.value);
  const month = currentMonth === 1 ? 12 : currentMonth - 1;
  const year = currentMonth === 1 ? currentYear - 1 : currentYear;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return {
    year,
    month,
    label: `${String(month).padStart(2, '0')}/${year}`,
    start: zonedTimeToUtcDate(year, month, 1, 0, 0, 0, TIMEZONE),
    end: zonedTimeToUtcDate(nextYear, nextMonth, 1, 0, 0, 0, TIMEZONE),
  };
}

type ReportRow = {
  reseller_id: string | null;
  seller_name: string | null;
  total_amount: number | string | null;
  total_items: number | string | null;
  order_id: string | null;
  reseller_earning: number | string | null;
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    const range = previousMonthRange();
    const admin = adminClient();
    const { data, error } = await admin
      .from('order_crm_summary')
      .select('reseller_id,seller_name,total_amount,total_items,order_id,reseller_earning')
      .gte('order_date', range.start.toISOString())
      .lt('order_date', range.end.toISOString())
      .not('reseller_id', 'is', null)
      .eq('payment_status', 'pago')
      .neq('status', 'cancelado')
      .neq('status', 'reembolsado');
    if (error) throw error;

    const grouped = new Map<string, {
      seller_name: string; total_amount: number; total_items: number;
      reseller_earning: number; orders: Set<string>;
    }>();
    for (const row of (data || []) as ReportRow[]) {
      const id = String(row.reseller_id || '');
      if (!id) continue;
      if (!grouped.has(id)) grouped.set(id, {
        seller_name: String(row.seller_name || '(sem nome)'),
        total_amount: 0, total_items: 0, reseller_earning: 0, orders: new Set<string>(),
      });
      const value = grouped.get(id)!;
      value.total_amount += Number(row.total_amount || 0);
      value.total_items += Number(row.total_items || 0);
      value.reseller_earning += Number(row.reseller_earning || 0);
      if (row.order_id) value.orders.add(String(row.order_id));
    }

    const resellers = Array.from(grouped.values()).map((value) => ({
      seller_name: value.seller_name,
      total_amount: value.total_amount,
      total_items: value.total_items,
      reseller_earning: value.reseller_earning,
      orders: value.orders.size,
    })).sort((a, b) => a.seller_name.localeCompare(b.seller_name, 'pt-BR'));
    const totals = resellers.reduce((accumulator, value) => ({
      total_amount: accumulator.total_amount + value.total_amount,
      total_items: accumulator.total_items + value.total_items,
      reseller_earning: accumulator.reseller_earning + value.reseller_earning,
      orders: accumulator.orders + value.orders,
    }), { total_amount: 0, total_items: 0, reseller_earning: 0, orders: 0 });

    const recipient = String(
      Deno.env.get('REPORT_EMAIL_TO') || Deno.env.get('NOTIFICATION_EMAIL_TO') || '',
    ).trim();
    if (!recipient) throw new Error('Destinatário do relatório mensal não configurado.');
    const crmUrl = String(Deno.env.get('CRM_URL') || '').trim();
    const outboxId = await enqueueEmail({
      category: 'internal',
      templateKey: 'monthly_reseller_report',
      recipientEmail: recipient,
      recipientName: 'Equipe Itajaó',
      senderKind: 'admin',
      subject: `Fechamento dos Revendedores — ${range.label}`,
      payload: {
        period_label: range.label,
        timezone: TIMEZONE,
        resellers,
        totals,
        crm_url: crmUrl,
      },
      idempotencyKey: `monthly-reseller-report:${range.year}-${String(range.month).padStart(2, '0')}`,
      resourceType: 'monthly_reseller_report',
      priority: 10,
    });

    return json({
      ok: true,
      queued: true,
      outbox_id: outboxId,
      period: { label: range.label, year: range.year, month: range.month, timezone: TIMEZONE },
      totals,
    });
  } catch (error) {
    console.error('Monthly reseller report failed', error);
    return json({ error: 'Não foi possível gerar o fechamento mensal.' }, 500);
  }
});
