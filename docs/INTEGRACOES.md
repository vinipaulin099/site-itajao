# Integrações do checkout Itajaó

Estrutura preparada para o fluxo:

`site → Melhor Envio (cotação) → Mercado Pago Checkout Pro → webhook → Bling (pedido de venda)`

O checkout novo começa **desligado**. Enquanto a configuração não for concluída, `produto.html` continua enviando o cliente para a Nuvemshop. Isso é controlado por `commerceCheckoutEnabled: false` em `store-config.js` e por `COMMERCE_ENABLED=false` no backend.

## O que já está implementado

- Página própria de carrinho com produtos, quantidades, cupom, CEP, frete, recomendações e total (`carrinho.html` + `cart.js`).
- Checkout separado, dedicado aos dados de entrega e à criação do pagamento (`checkout.html` + `checkout.js`).
- Carrinho persistente no navegador e revalidação completa no servidor.
- Catálogo público carregado de `public.products`, com fallback seguro enquanto a migration não foi aplicada.
- Cupom `BEMVINDO10` validado no servidor e confirmado novamente com os dados do cliente na finalização.
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

1. Execute `supabase/migrations/202608070001_commerce.sql` no mesmo projeto Supabase usado pelo site, caso ela ainda não tenha sido aplicada.
2. Execute `supabase/migrations/202608100001_storefront_catalog_and_coupons.sql` para adicionar os campos de catálogo, cupons e a nova assinatura atômica do checkout.
3. Publique `store-catalog`, `coupon-quote`, `shipping-quote` e `create-checkout` na mesma atualização.
4. Cadastre os secrets listados em `supabase/functions/.env.example` nas configurações das Edge Functions. Nunca envie os valores reais para o GitHub.
5. Confira CEP de origem, dimensões, pesos e IDs dos produtos no Bling.
6. Faça os testes com `COMMERCE_ENABLED=false`. Quando funções, tokens, webhooks, cupons e e-mails estiverem validados, mude primeiro o secret para `COMMERCE_ENABLED=true` e, por último, `commerceCheckoutEnabled` para `true` em `assets/js/store-config.js`.

## Catálogo e cupons

O site lê nome, preço, disponibilidade, imagens, descrição, peso e dimensões diretamente de `public.products` por meio da função pública `store-catalog`. O navegador nunca define o preço aceito pelo pedido; `create-checkout` carrega o mesmo catálogo novamente.

Os cupons ficam em `public.store_coupons` e os usos em `public.store_coupon_redemptions`. As tabelas não são expostas diretamente ao navegador. A migration cria `BEMVINDO10` com 10% de desconto e restrição de primeira compra. O carrinho faz uma cotação preliminar, e a função SQL revalida e registra o uso na mesma transação do pedido.

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
supabase functions deploy store-catalog
supabase functions deploy coupon-quote
supabase functions deploy create-checkout
supabase functions deploy mercadopago-webhook
supabase functions deploy order-status
supabase functions deploy integration-oauth
supabase functions deploy sync-order
```

Antes de ativar vendas reais, execute pelo menos: cotação de CEP MG/SP/outro estado, frete grátis nos dois limites, pagamento aprovado, pendente e recusado, webhook com assinatura inválida, criação de contato/pedido no Bling e repetição do mesmo webhook.
