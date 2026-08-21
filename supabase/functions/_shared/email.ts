import { dbRequest } from './db.ts';
import { env } from './core.ts';

export type EmailCategory = 'transactional' | 'marketing' | 'internal' | 'auth';
export type SenderKind = 'customer' | 'admin';

export type EmailOutboxRow = {
  id: string;
  category: EmailCategory;
  template_key: string;
  recipient_email: string;
  recipient_name: string | null;
  sender_kind: SenderKind;
  subject: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  claim_token: string;
  resource_type: string | null;
  resource_id: string | null;
};

export type QueueEmailInput = {
  category: EmailCategory;
  templateKey: string;
  recipientEmail: string;
  recipientName?: string | null;
  senderKind?: SenderKind;
  subject: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  relatedOrderId?: string | null;
  relatedCustomerId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  priority?: number;
};

type RuntimeEmailConfig = {
  notification_email_to: string;
  customer_email_from: string;
  notification_email_from: string;
  reply_to_email: string;
};

let runtimeEmailConfigPromise: Promise<RuntimeEmailConfig | null> | null = null;

async function runtimeEmailConfig() {
  if (!runtimeEmailConfigPromise) {
    runtimeEmailConfigPromise = dbRequest(
      'email_runtime_config?singleton=eq.true&select=notification_email_to,customer_email_from,notification_email_from,reply_to_email&limit=1',
    ).then((rows) => (rows?.[0] || null) as RuntimeEmailConfig | null);
  }
  return await runtimeEmailConfigPromise;
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] ?? character);
}

function paragraphs(value: unknown) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function text(value: unknown, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function money(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(amount) ? amount : 0);
}

function firstName(value: unknown) {
  return text(value, 'Olá').split(/\s+/)[0];
}

function siteUrl(path = '') {
  const base = String(Deno.env.get('SITE_URL') || 'https://vinipaulin099.github.io/site-itajao').replace(/\/+$/, '');
  return path ? `${base}/${path.replace(/^\/+/, '')}` : base;
}

function orderUrl(payload: Record<string, unknown>) {
  const direct = text(payload.order_url);
  if (direct) return direct;
  const orderId = text(payload.order_id);
  const token = text(payload.public_token);
  if (!orderId || !token) return '';
  const url = new URL(siteUrl('pedido.html'));
  url.searchParams.set('order', orderId);
  url.searchParams.set('token', token);
  return url.toString();
}

function button(label: string, href: string) {
  if (!href) return '';
  return `<p style="margin:26px 0 8px"><a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#6f4e37;color:#fff;text-decoration:none;font-size:13px;font-weight:700">${escapeHtml(label)}</a></p>`;
}

function layout(options: {
  preview: string;
  eyebrow?: string;
  title: string;
  body: string;
  action?: string;
  actionLabel?: string;
  unsubscribeUrl?: string;
}) {
  const action = options.action && options.actionLabel ? button(options.actionLabel, options.action) : '';
  const unsubscribe = options.unsubscribeUrl
    ? `<p style="margin:22px 0 0;color:#94877d;font-size:11px;line-height:1.6">Você recebeu esta mensagem porque se cadastrou para receber novidades da Itajaó. <a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#6f4e37">Cancelar inscrição</a>.</p>`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f6eee5;font-family:Arial,Helvetica,sans-serif;color:#3d2b1f">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(options.preview)}</div>
  <div style="max-width:640px;margin:0 auto;padding:28px 14px">
    <div style="background:#3d2b1f;padding:24px 26px;border-radius:14px 14px 0 0">
      <div style="font-size:11px;letter-spacing:.16em;color:#ecb176;font-weight:700">${escapeHtml(options.eyebrow || 'ITAJAÓ CAFÉS ESPECIAIS')}</div>
      <h1 style="margin:9px 0 0;color:#fed8b1;font-size:25px;line-height:1.25">${escapeHtml(options.title)}</h1>
    </div>
    <div style="background:#fffdf9;border:1px solid #eadbcd;border-top:0;border-radius:0 0 14px 14px;padding:26px">
      <div style="font-size:14px;line-height:1.75;color:#55463c">${options.body}</div>
      ${action}
      ${unsubscribe}
      <p style="margin:26px 0 0;padding-top:18px;border-top:1px solid #eee2d6;color:#9a8c82;font-size:11px;line-height:1.6">O sabor que abraça sua manhã.<br>Itajaó Cafés Especiais · Sul de Minas</p>
    </div>
  </div>
</body>
</html>`;
}

export function renderEmail(row: Pick<EmailOutboxRow, 'template_key' | 'payload' | 'recipient_name'>) {
  const payload = row.payload || {};
  const name = firstName(payload.customer_name || payload.name || row.recipient_name);
  const orderNumber = text(payload.order_number, text(payload.order_id).slice(0, 8));
  const viewOrder = orderUrl(payload);

  switch (row.template_key) {
    case 'order_received':
      return layout({
        preview: `Recebemos o pedido ${orderNumber}.`,
        title: 'Recebemos seu pedido',
        body: `<p style="margin:0 0 14px">Olá, ${escapeHtml(name)}!</p><p style="margin:0 0 14px">O pedido <strong>${escapeHtml(orderNumber)}</strong> foi criado e está aguardando a confirmação do pagamento.</p><p style="margin:0">Produtos: <strong>${money(payload.subtotal)}</strong><br>Frete: <strong>${money(payload.shipping_amount)}</strong><br>Total: <strong>${money(payload.total_amount)}</strong></p>`,
        action: viewOrder,
        actionLabel: 'Acompanhar pedido',
      });

    case 'payment_approved':
      return layout({
        preview: `Pagamento do pedido ${orderNumber} aprovado.`,
        title: 'Pagamento aprovado',
        body: `<p style="margin:0 0 14px">Olá, ${escapeHtml(name)}!</p><p style="margin:0">O pagamento do pedido <strong>${escapeHtml(orderNumber)}</strong>, no valor de <strong>${money(payload.total_amount)}</strong>, foi aprovado. Agora vamos preparar seu Café Itajaó com todo cuidado.</p>`,
        action: viewOrder,
        actionLabel: 'Acompanhar pedido',
      });

    case 'payment_cancelled':
      return layout({
        preview: `O pagamento do pedido ${orderNumber} não foi concluído.`,
        title: 'Pagamento não concluído',
        body: `<p style="margin:0 0 14px">Olá, ${escapeHtml(name)}.</p><p style="margin:0">O pagamento do pedido <strong>${escapeHtml(orderNumber)}</strong> foi cancelado ou recusado. Se precisar de ajuda, responda este e-mail e nós cuidamos disso com você.</p>`,
        action: viewOrder,
        actionLabel: 'Ver pedido',
      });

    case 'payment_refunded':
      return layout({
        preview: `O pedido ${orderNumber} foi reembolsado.`,
        title: 'Reembolso confirmado',
        body: `<p style="margin:0 0 14px">Olá, ${escapeHtml(name)}.</p><p style="margin:0">Registramos o reembolso do pedido <strong>${escapeHtml(orderNumber)}</strong>. O prazo para o valor aparecer depende do meio de pagamento utilizado.</p>`,
        action: viewOrder,
        actionLabel: 'Ver pedido',
      });

    case 'order_shipped':
      return layout({
        preview: `Seu pedido ${orderNumber} está a caminho.`,
        title: 'Seu café está a caminho',
        body: `<p style="margin:0 0 14px">Olá, ${escapeHtml(name)}!</p><p style="margin:0 0 14px">O pedido <strong>${escapeHtml(orderNumber)}</strong> foi enviado.</p>${text(payload.tracking_code) ? `<p style="margin:0">Código de rastreio: <strong>${escapeHtml(payload.tracking_code)}</strong></p>` : ''}`,
        action: viewOrder,
        actionLabel: 'Acompanhar entrega',
      });

    case 'order_delivered':
      return layout({
        preview: `O pedido ${orderNumber} foi entregue.`,
        title: 'Pedido entregue',
        body: `<p style="margin:0 0 14px">Olá, ${escapeHtml(name)}!</p><p style="margin:0">Seu pedido <strong>${escapeHtml(orderNumber)}</strong> foi marcado como entregue. Esperamos que cada xícara abrace sua manhã.</p>`,
        action: viewOrder,
        actionLabel: 'Ver pedido',
      });

    case 'review_invite':
      return layout({
        preview: 'Conte como foi sua experiência com o Café Itajaó.',
        title: 'Como foi seu Café Itajaó?',
        body: `<p style="margin:0 0 14px">Olá, ${escapeHtml(name)}!</p><p style="margin:0 0 16px">Seu Café Itajaó já rendeu boas xícaras? Sua opinião ajuda outras pessoas a escolherem um café especial e também nos ajuda a melhorar sempre.</p><div style="padding:16px;border-radius:10px;background:#f6eee5;text-align:center"><strong style="display:block;color:#3d2b1f">Seu link já reconhece o pedido</strong><span style="display:block;margin-top:6px;font-size:12px;color:#94755e">Toque no botão abaixo para abrir diretamente a avaliação.</span></div>`,
        action: text(payload.review_url),
        actionLabel: 'Avaliar meu café',
      });

    case 'review_received':
      return layout({
        preview: 'Recebemos sua avaliação.',
        title: 'Avaliação recebida',
        body: `<p style="margin:0 0 14px">Obrigado, ${escapeHtml(name)}!</p><p style="margin:0">Sua avaliação foi recebida e será analisada antes de aparecer na Comunidade Itajaó.</p>`,
        action: siteUrl('comunidade.html'),
        actionLabel: 'Conhecer a comunidade',
      });

    case 'review_published':
      return layout({
        preview: 'Sua avaliação foi publicada.',
        title: 'Sua avaliação está no ar',
        body: `<p style="margin:0 0 14px">Olá, ${escapeHtml(name)}!</p><p style="margin:0">Sua avaliação sobre <strong>${escapeHtml(payload.product_name)}</strong> foi aprovada e já faz parte da Comunidade Itajaó.</p>`,
        action: text(payload.community_url, siteUrl('comunidade.html')),
        actionLabel: 'Ver avaliação',
      });

    case 'recipe_received':
      return layout({
        preview: 'Recebemos sua receita para o Itajaó.',
        title: 'Receita recebida',
        body: `<p style="margin:0 0 14px">Obrigado, ${escapeHtml(name)}!</p><p style="margin:0">A receita <strong>${escapeHtml(payload.recipe_title)}</strong> chegou para nossa equipe e será analisada antes da publicação.</p>`,
        action: siteUrl('comunidade.html#receitas'),
        actionLabel: 'Ver receitas',
      });

    case 'recipe_published':
      return layout({
        preview: 'Sua receita foi publicada.',
        title: 'Sua receita está no ar',
        body: `<p style="margin:0 0 14px">Olá, ${escapeHtml(name)}!</p><p style="margin:0">A receita <strong>${escapeHtml(payload.recipe_title)}</strong> foi aprovada e já está na Comunidade Itajaó.</p>`,
        action: text(payload.community_url, siteUrl('comunidade.html#receitas')),
        actionLabel: 'Ver receita',
      });

    case 'newsletter_welcome':
      return layout({
        preview: 'Você entrou para a lista da Itajaó.',
        title: 'Tem café fresco chegando por aqui',
        body: `<p style="margin:0 0 14px">Olá, ${escapeHtml(name)}!</p><p style="margin:0">Seu cadastro foi confirmado. A partir de agora você receberá novidades, conteúdos sobre café e promoções da Itajaó.</p>`,
        action: siteUrl(),
        actionLabel: 'Visitar a Itajaó',
        unsubscribeUrl: text(payload.unsubscribe_url),
      });

    case 'crm_notification':
    case 'admin_review_received':
    case 'admin_recipe_received':
      return layout({
        preview: text(payload.title, 'Novo aviso no CRM Itajaó.'),
        eyebrow: 'CRM ITAJAÓ',
        title: text(payload.title, 'Novo aviso'),
        body: `<p style="margin:0">${paragraphs(payload.message)}</p>`,
        action: text(payload.crm_url),
        actionLabel: 'Abrir CRM',
      });

    case 'monthly_reseller_report': {
      const resellers = Array.isArray(payload.resellers) ? payload.resellers : [];
      const rows = resellers.map((value) => {
        const reseller = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        return `<tr>
          <td style="padding:10px 7px;border-bottom:1px solid #eee2d6">${escapeHtml(reseller.seller_name)}</td>
          <td style="padding:10px 7px;border-bottom:1px solid #eee2d6;text-align:right">${escapeHtml(reseller.total_items)}</td>
          <td style="padding:10px 7px;border-bottom:1px solid #eee2d6;text-align:right">${escapeHtml(reseller.orders)}</td>
          <td style="padding:10px 7px;border-bottom:1px solid #eee2d6;text-align:right">${money(reseller.total_amount)}</td>
          <td style="padding:10px 7px;border-bottom:1px solid #eee2d6;text-align:right">${money(reseller.reseller_earning)}</td>
        </tr>`;
      }).join('');
      const totals = payload.totals && typeof payload.totals === 'object'
        ? payload.totals as Record<string, unknown>
        : {};
      const table = rows
        ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr>
            <th style="padding:9px 7px;text-align:left;border-bottom:2px solid #d8c6b5">Revendedor</th>
            <th style="padding:9px 7px;text-align:right;border-bottom:2px solid #d8c6b5">Produtos</th>
            <th style="padding:9px 7px;text-align:right;border-bottom:2px solid #d8c6b5">Pedidos</th>
            <th style="padding:9px 7px;text-align:right;border-bottom:2px solid #d8c6b5">Vendas</th>
            <th style="padding:9px 7px;text-align:right;border-bottom:2px solid #d8c6b5">Comissão</th>
          </tr></thead><tbody>${rows}</tbody>
          <tfoot><tr>
            <td style="padding:11px 7px;font-weight:700;border-top:2px solid #d8c6b5">Total</td>
            <td style="padding:11px 7px;text-align:right;font-weight:700;border-top:2px solid #d8c6b5">${escapeHtml(totals.total_items)}</td>
            <td style="padding:11px 7px;text-align:right;font-weight:700;border-top:2px solid #d8c6b5">${escapeHtml(totals.orders)}</td>
            <td style="padding:11px 7px;text-align:right;font-weight:700;border-top:2px solid #d8c6b5">${money(totals.total_amount)}</td>
            <td style="padding:11px 7px;text-align:right;font-weight:700;border-top:2px solid #d8c6b5">${money(totals.reseller_earning)}</td>
          </tr></tfoot></table></div>`
        : '<p style="margin:0">Não houve vendas de revendedores no período analisado.</p>';
      return layout({
        preview: `Fechamento dos revendedores — ${text(payload.period_label)}.`,
        eyebrow: 'CRM ITAJAÓ',
        title: `Fechamento dos revendedores — ${text(payload.period_label)}`,
        body: `<p style="margin:0 0 16px">Relatório mensal consolidado por revendedor.</p>${table}`,
        action: text(payload.crm_url),
        actionLabel: 'Abrir CRM',
      });
    }

    default:
      return layout({
        preview: text(payload.preview, 'Mensagem da Itajaó Cafés Especiais.'),
        title: text(payload.title, 'Itajaó Cafés Especiais'),
        body: `<p style="margin:0">${paragraphs(payload.message)}</p>`,
        action: text(payload.action_url),
        actionLabel: text(payload.action_label, 'Saiba mais'),
        unsubscribeUrl: text(payload.unsubscribe_url),
      });
  }
}

export async function enqueueEmail(input: QueueEmailInput) {
  return await dbRequest('rpc/enqueue_email', {
    method: 'POST',
    body: JSON.stringify({
      p_category: input.category,
      p_template_key: input.templateKey,
      p_recipient_email: input.recipientEmail.trim().toLowerCase(),
      p_recipient_name: input.recipientName || null,
      p_sender_kind: input.senderKind || 'customer',
      p_subject: input.subject,
      p_payload: input.payload || {},
      p_idempotency_key: input.idempotencyKey,
      p_related_order_id: input.relatedOrderId || null,
      p_related_customer_id: input.relatedCustomerId || null,
      p_resource_type: input.resourceType || null,
      p_resource_id: input.resourceId || null,
      p_priority: input.priority ?? 100,
    }),
  });
}

export async function adminRecipientEmail() {
  const configured = String(
    Deno.env.get('NOTIFICATION_EMAIL_TO') || Deno.env.get('REPORT_EMAIL_TO') || '',
  ).trim();
  if (configured) return configured;
  return String((await runtimeEmailConfig())?.notification_email_to || '').trim();
}

export async function senderAddress(kind: SenderKind) {
  const address = kind === 'admin'
    ? Deno.env.get('NOTIFICATION_EMAIL_FROM') || Deno.env.get('REPORT_EMAIL_FROM')
    : Deno.env.get('CUSTOMER_EMAIL_FROM') || Deno.env.get('REPORT_EMAIL_FROM');
  if (address?.trim()) return address.trim();
  const fallback = await runtimeEmailConfig();
  const runtimeAddress = kind === 'admin'
    ? fallback?.notification_email_from
    : fallback?.customer_email_from;
  if (!runtimeAddress?.trim()) throw new Error(`Remetente ${kind} não configurado.`);
  return runtimeAddress.trim();
}

export async function sendWithResend(row: Pick<EmailOutboxRow, 'id' | 'category' | 'recipient_email' | 'sender_kind' | 'subject' | 'payload' | 'template_key' | 'recipient_name'>) {
  const apiKey = env('RESEND_API_KEY');
  const html = renderEmail(row);
  let replyTo = String(
    Deno.env.get('REPLY_TO_EMAIL')
      || Deno.env.get('CUSTOMER_EMAIL_FROM')
      || Deno.env.get('REPORT_EMAIL_FROM')
      || '',
  ).trim();
  if (!replyTo) replyTo = String((await runtimeEmailConfig())?.reply_to_email || '').trim();
  if (!replyTo) throw new Error('Endereço de resposta não configurado.');
  const resendBody: Record<string, unknown> = {
    from: await senderAddress(row.sender_kind),
    to: [row.recipient_email],
    reply_to: replyTo,
    subject: row.subject,
    html,
    tags: [
      { name: 'category', value: row.category },
      { name: 'template', value: row.template_key },
      { name: 'outbox_id', value: row.id },
    ],
  };

  const unsubscribeUrl = text(row.payload?.unsubscribe_url);
  if (row.category === 'marketing' && unsubscribeUrl) {
    resendBody.headers = {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(resendBody),
  });
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(raw); } catch { data = { detail: raw.slice(0, 500) }; }

  return {
    ok: response.ok,
    status: response.status,
    id: text(data.id),
    error: response.ok ? '' : raw.slice(0, 1500),
  };
}
