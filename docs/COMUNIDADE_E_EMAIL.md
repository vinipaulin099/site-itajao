# Comunidade Itajaó e central de e-mails

Esta entrega adiciona avaliações de compra verificada, receitas da comunidade e uma fila única para mensagens do site e do CRM.

## Fluxos implementados

- O cron do CRM identifica pedidos pagos com pelo menos 3 dias e cria um aviso `review_invite_due` para os administradores.
- `community-admin` gera um link secreto e um código aleatório de 6 dígitos, válidos por 30 dias e limitados a 5 tentativas, além da mensagem pronta para WhatsApp.
- O cliente pode avaliar um ou mais produtos do pedido, com nota, título, comentário e foto opcional.
- Avaliações e receitas ficam privadas até aprovação de um administrador.
- Conteúdo aprovado aparece na home, na página do produto e em `comunidade.html`.
- Clientes e administradores recebem mensagens pelo mesmo `email_outbox`, com idempotência, retentativas e registro dos eventos do Resend.
- Bounce, denúncia de spam e descadastro entram em `email_suppressions`.

## Ordem de publicação

1. Aplicar `supabase/migrations/20260812010103_community_email_center.sql`.
2. Publicar as funções:

   ```bash
   supabase functions deploy newsletter-signup
   supabase functions deploy newsletter-unsubscribe
   supabase functions deploy community-feed
   supabase functions deploy community-review
   supabase functions deploy community-recipe
   supabase functions deploy community-admin
   supabase functions deploy crm-notification-dispatch
   supabase functions deploy resend-webhook
   supabase functions deploy auth-email-hook
   supabase functions deploy create-checkout
   supabase functions deploy monthly-reseller-report
   ```

3. Configurar os secrets descritos em `supabase/functions/.env.example`.
4. No Resend, criar um webhook para:

   `https://eumgdopgiffzpahzcdsq.supabase.co/functions/v1/resend-webhook`

   Habilitar eventos de entrega, falha, bounce, denúncia, supressão, abertura e clique. Salvar o signing secret como `RESEND_WEBHOOK_SECRET`.
5. No Supabase Auth, configurar o hook **Send Email** com:

   `https://eumgdopgiffzpahzcdsq.supabase.co/functions/v1/auth-email-hook`

   Salvar o secret gerado como `SEND_EMAIL_HOOK_SECRET` antes de ativar o hook.

## Integração da tela do CRM

A função `community-admin` exige o JWT de um usuário cujo perfil seja `admin`. As ações aceitas são:

| Ação | Uso |
|---|---|
| `eligible_orders` | Lista pedidos que já podem receber convite. |
| `create_review_invite` | Recebe `order_id` e `send_email`; devolve `whatsapp_url`, mensagem, link e código. |
| `pending` | Lista avaliações e receitas aguardando análise. |
| `moderate_review` | Recebe `id`, `status`, resposta pública e nota interna. |
| `moderate_recipe` | Recebe `id`, `status`, resposta pública e nota interna. |

Exemplo de corpo para gerar o convite:

```json
{
  "action": "create_review_invite",
  "order_id": "UUID_DO_PEDIDO",
  "send_email": false
}
```

O CRM deve abrir o `whatsapp_url` retornado. O código puro nunca é armazenado no banco; somente hashes são persistidos.

## Remetentes

Os remetentes e o endereço de resposta são configurados somente nos secrets
`CUSTOMER_EMAIL_FROM`, `NOTIFICATION_EMAIL_FROM`, `REPORT_EMAIL_FROM` e
`REPLY_TO_EMAIL` do Supabase. Nenhum endereço administrativo fica gravado no
repositório público.

Enquanto os secrets legados não estiverem migrados, a tabela privada
`email_runtime_config` fornece o fallback dos remetentes e reaproveita o
destinatário já validado pelos alertas anteriores do CRM. Ela não possui acesso
para `anon` nem `authenticated`.

Não adicione chaves do Resend, service role ou secrets de webhook ao repositório.
