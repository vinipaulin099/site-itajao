import { renderEmail } from '../supabase/functions/_shared/email.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test('escapa dados do cliente nos templates', () => {
  Deno.env.set('SITE_URL', 'https://cafeitajao.com.br');
  const html = renderEmail({
    template_key: 'review_published',
    recipient_name: '<Cliente>',
    payload: {
      customer_name: '<img src=x onerror=alert(1)>',
      product_name: '<script>alert(1)</script>',
      community_url: 'https://cafeitajao.com.br/comunidade.html',
    },
  });
  assert(!html.includes('<script>alert(1)</script>'), 'Produto não foi escapado.');
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Texto escapado não encontrado.');
});

Deno.test('newsletter inclui descadastro e cabeçalhos visuais', () => {
  Deno.env.set('SITE_URL', 'https://cafeitajao.com.br');
  const html = renderEmail({
    template_key: 'newsletter_welcome',
    recipient_name: 'Vinícius',
    payload: {
      name: 'Vinícius',
      unsubscribe_url: 'https://example.supabase.co/functions/v1/newsletter-unsubscribe?token=abc',
    },
  });
  assert(html.includes('Cancelar inscrição'), 'Link de descadastro ausente.');
  assert(html.includes('https://example.supabase.co/functions/v1/newsletter-unsubscribe?token=abc'), 'URL de descadastro ausente.');
});

Deno.test('notificação administrativa escapa dados da newsletter', () => {
  const html = renderEmail({
    template_key: 'crm_notification',
    recipient_name: 'Equipe Itajaó',
    payload: {
      title: 'Novo cadastro na newsletter',
      message: '<script>alert(1)</script> entrou para a lista.',
      crm_url: 'https://cafeitajao.com.br/admin-comunidade.html',
    },
  });
  assert(!html.includes('<script>alert(1)</script>'), 'Mensagem administrativa não foi escapada.');
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Mensagem administrativa escapada não encontrada.');
  assert(html.includes('Abrir CRM'), 'Atalho para o painel administrativo ausente.');
});

Deno.test('relatório mensal aceita apenas dados estruturados escapados', () => {
  Deno.env.set('SITE_URL', 'https://cafeitajao.com.br');
  const html = renderEmail({
    template_key: 'monthly_reseller_report',
    recipient_name: 'Equipe',
    payload: {
      period_label: '07/2026',
      resellers: [{
        seller_name: '<b>Revendedor</b>', total_items: 2, orders: 1,
        total_amount: 100, reseller_earning: 20,
      }],
      totals: { total_items: 2, orders: 1, total_amount: 100, reseller_earning: 20 },
    },
  });
  assert(!html.includes('<b>Revendedor</b>'), 'Nome do revendedor não foi escapado.');
  assert(html.includes('&lt;b&gt;Revendedor&lt;/b&gt;'), 'Nome escapado não encontrado.');
  assert(html.includes('R$'), 'Valores monetários não foram renderizados.');
});
