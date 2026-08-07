# Integrações do checkout Itajaó

Estrutura preparada para o fluxo:

`site → Melhor Envio (cotação) → Mercado Pago Checkout Pro → webhook → Bling (pedido de venda)`

O checkout novo começa **desligado**. Enquanto a configuração não for concluída, `produto.html` continua enviando o cliente para a Nuvemshop. Isso é controlado por `commerceCheckoutEnabled: false` em `store-config.js` e por `COMMERCE_ENABLED=false` no backend.

## O que já está implementado

- Carrinho próprio com vários produtos e quantidade (`checkout.html` + `checkout.js`).
- Formulário de cliente/endereço e preenchimento auxiliar pelo CEP.
- Cotação de frete server-side no Melhor Envio. O navegador envia apenas IDs e quantidades; preço, peso e dimensões são reconstruídos no backend.
- Política de frete grátis já considerada na cotação: Sudeste a partir de R$ 249,90 e demais regiões a partir de R$ 399,90.
- Revalidação do frete no servidor ao finalizar a compra para impedir alteração de preço pelo navegador.
- Criação de preferência do Mercado Pago Checkout Pro com produtos, frete, cliente, URLs de retorno e `external_reference` do pedido.
- Webhook Mercado Pago com validação HMAC SHA-256 via `x-signature`, nova consulta do pagamento na API e conferência de moeda/valor antes de aprovar o pedido localmente.
- Sincronização do pagamento aprovado para um pedido de venda no Bling.
- OAuth do Bling e do Melhor Envio com tokens/refresh tokens armazenados somente em tabela privada.
- Página `pedido.html` para consultar o status sem expor dados pessoais.
- Tabelas com RLS e sem acesso direto para `anon`/`authenticated`.
- Fallback para a Nuvemshop até o novo fluxo passar pelos testes.

## O que precisa ser configurado antes de ligar

1. Execute `supabase/migrations/202608070001_commerce.sql` no mesmo projeto Supabase usado pelo site.
2. Cadastre os secrets listados em `supabase/functions/.env.example` nas configurações das Edge Functions. Nunca envie os valores reais para o GitHub.
3. Informe o CEP/endereço real de origem e as dimensões externas reais dos pacotes. O backend não usa dimensões inventadas; sem elas a cotação é bloqueada.
4. Informe os IDs no Bling correspondentes aos cinco SKUs definidos em `supabase/functions/_shared/catalog.ts`.
5. Faça os testes com `COMMERCE_ENABLED=false`. Quando as funções, tokens e webhooks estiverem validados, mude primeiro o secret para `COMMERCE_ENABLED=true` e, por último, `commerceCheckoutEnabled` para `true` em `store-config.js`.

## Mercado Pago

Secrets:

- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`
- `MP_USE_SANDBOX=true` durante os testes; `false` em produção.

Webhook de produção:

`https://eumgdopgiffzpahzcdsq.supabase.co/functions/v1/mercadopago-webhook`

No painel do Mercado Pago, configure o evento **Pagamentos** e copie a chave secreta gerada para `MP_WEBHOOK_SECRET`.

Observação: a documentação do Mercado Pago informa que pagamentos criados com credenciais de teste não enviam notificações reais; o receptor deve ser testado também com o simulador de Webhooks do painel.

## Melhor Envio

Durante homologação use `ME_ENV=sandbox`. Na conta sandbox, crie um aplicativo com a callback exatamente igual a:

`https://eumgdopgiffzpahzcdsq.supabase.co/functions/v1/integration-oauth?provider=melhorenvio&action=callback`

Depois de configurar `ME_CLIENT_ID`, `ME_CLIENT_SECRET`, `ME_REDIRECT_URI`, `ADMIN_SETUP_TOKEN` e `INTEGRATION_STATE_SECRET`, gere a URL de autorização com:

```bash
curl -X POST \
  'https://eumgdopgiffzpahzcdsq.supabase.co/functions/v1/integration-oauth?provider=melhorenvio&action=start' \
  -H 'x-admin-token: SEU_ADMIN_SETUP_TOKEN'
```

Abra no navegador a `authorizeUrl` retornada. A callback troca o `code` e salva os tokens sem expô-los no frontend.

Para produção, crie/autorize o aplicativo do ambiente de produção separadamente e troque `ME_ENV=production`.

## Bling

Crie um aplicativo API v3 e libere somente os escopos necessários para contatos e pedidos de venda (leitura/escrita) e produtos conforme necessário para a conta.

Callback cadastrada no aplicativo:

`https://eumgdopgiffzpahzcdsq.supabase.co/functions/v1/integration-oauth?provider=bling&action=callback`

Depois de configurar `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `ADMIN_SETUP_TOKEN` e `INTEGRATION_STATE_SECRET`, gere a autorização:

```bash
curl -X POST \
  'https://eumgdopgiffzpahzcdsq.supabase.co/functions/v1/integration-oauth?provider=bling&action=start' \
  -H 'x-admin-token: SEU_ADMIN_SETUP_TOKEN'
```

O código usa JWT no OAuth do Bling (`enable-jwt: 1`) e renova o token automaticamente quando necessário.

Se um pagamento já aprovado precisar ser reenviado manualmente ao Bling:

```bash
curl -X POST \
  'https://eumgdopgiffzpahzcdsq.supabase.co/functions/v1/sync-order' \
  -H 'Content-Type: application/json' \
  -H 'x-admin-token: SEU_ADMIN_SETUP_TOKEN' \
  -d '{"orderId":"UUID_DO_PEDIDO"}'
```

## NF-e e etiqueta

Nesta etapa o pedido pago entra automaticamente no Bling, mas a emissão da NF-e e a compra/geração automática da etiqueta ainda não são acionadas pelo código.

Isso é proposital: para emitir NF-e precisamos usar a natureza de operação, série e demais parâmetros fiscais corretos já configurados na sua conta. Além disso, para um envio comercial o Melhor Envio exige a chave da NF-e no momento de inserir o frete no carrinho de etiquetas. Esses dados não devem ser inventados.

As colunas `nfe_id`, `nfe_key`, `melhorenvio_order_id`, `tracking_code` e `label_url` já foram deixadas no banco para a continuação desse fluxo depois da validação fiscal.

## Deploy das Edge Functions

Com Supabase CLI vinculada ao projeto:

```bash
supabase functions deploy shipping-quote
supabase functions deploy create-checkout
supabase functions deploy mercadopago-webhook
supabase functions deploy order-status
supabase functions deploy integration-oauth
supabase functions deploy sync-order
```

Antes de ativar vendas reais, execute pelo menos: cotação de CEP MG/SP/outro estado, frete grátis nos dois limites, pagamento aprovado, pendente e recusado, webhook com assinatura inválida, criação de contato/pedido no Bling e repetição do mesmo webhook.

