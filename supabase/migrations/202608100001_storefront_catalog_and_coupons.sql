-- ITAJAÓ CAFÉS ESPECIAIS — catálogo administrável, cupons e checkout v2.
--
-- Esta migration reaproveita public.products, public.orders e public.order_items.
-- Ela não cria uma segunda base comercial e não apaga registros existentes.

begin;

alter table public.products
  add column if not exists store_key text,
  add column if not exists store_visible boolean not null default false,
  add column if not exists store_sort_order integer not null default 0,
  add column if not exists compare_at_price numeric(12,2),
  add column if not exists store_format text,
  add column if not exists store_short_description text,
  add column if not exists store_description text,
  add column if not exists store_images jsonb not null default '[]'::jsonb,
  add column if not exists store_legacy_url text,
  add column if not exists shipping_width_cm numeric(8,2),
  add column if not exists shipping_height_cm numeric(8,2),
  add column if not exists shipping_length_cm numeric(8,2),
  add column if not exists package_env_key text,
  add column if not exists bling_env_key text,
  add column if not exists bling_product_id bigint;

create unique index if not exists products_store_key_uidx
  on public.products (store_key)
  where store_key is not null;

-- Garante a presença dos cinco itens já oferecidos no site. Se o CRM possuir
-- uma regra adicional obrigatória em products, a migration preserva os itens
-- existentes e registra um aviso; o endpoint mantém o catálogo seguro de
-- fallback até o cadastro administrativo ser concluído.
do $$
begin
  insert into public.products (sku, name, weight_grams, sale_price, active)
  select seed.sku, seed.name, seed.weight_grams, seed.sale_price, seed.active
    from (
      values
        ('ITAJAO-GRAOS-500', 'Itajaó Especial 500g em Grãos', 500, 56.90::numeric, true),
        ('ITAJAO-MOIDO-500', 'Itajaó Especial 500g Moído', 500, 54.90::numeric, true),
        ('ITAJAO-GRAOS-250', 'Itajaó Especial 250g em Grãos', 250, 31.90::numeric, false),
        ('ITAJAO-MOIDO-250', 'Itajaó Especial 250g Moído', 250, 29.90::numeric, true),
        ('ITAJAO-KIT-1KG', 'Kit Itajaó Especial 1kg', 1000, 103.90::numeric, true)
    ) as seed(sku, name, weight_grams, sale_price, active)
   where not exists (
     select 1 from public.products p where p.sku = seed.sku
   );
exception
  when others then
    raise warning 'Não foi possível semear todos os produtos do site: %', sqlerrm;
end;
$$;

update public.products
   set store_key = null,
       store_visible = false
 where sku in (
   'ITAJAO-GRAOS-500', 'ITAJAO-MOIDO-500', 'ITAJAO-GRAOS-250',
   'ITAJAO-MOIDO-250', 'ITAJAO-KIT-1KG'
 );

with canonical as (
  select id,
         row_number() over (
           partition by sku
           order by active desc, created_at asc, id asc
         ) as store_rank
    from public.products
   where sku in (
     'ITAJAO-GRAOS-500', 'ITAJAO-MOIDO-500', 'ITAJAO-GRAOS-250',
     'ITAJAO-MOIDO-250', 'ITAJAO-KIT-1KG'
   )
)
update public.products p
   set store_key = case sku
         when 'ITAJAO-GRAOS-500' then 'graos500'
         when 'ITAJAO-MOIDO-500' then 'moido500'
         when 'ITAJAO-GRAOS-250' then 'graos250'
         when 'ITAJAO-MOIDO-250' then 'moido250'
         when 'ITAJAO-KIT-1KG' then 'kit1kg'
       end,
       store_visible = true,
       store_sort_order = case sku
         when 'ITAJAO-GRAOS-500' then 10
         when 'ITAJAO-MOIDO-500' then 20
         when 'ITAJAO-GRAOS-250' then 30
         when 'ITAJAO-MOIDO-250' then 40
         when 'ITAJAO-KIT-1KG' then 50
       end,
       compare_at_price = case sku
         when 'ITAJAO-GRAOS-500' then 62.90
         when 'ITAJAO-MOIDO-500' then 60.90
         when 'ITAJAO-GRAOS-250' then 38.90
         when 'ITAJAO-MOIDO-250' then 36.90
         when 'ITAJAO-KIT-1KG' then 104.90
       end,
       store_format = case sku
         when 'ITAJAO-GRAOS-500' then 'Em Grãos'
         when 'ITAJAO-MOIDO-500' then 'Moído'
         when 'ITAJAO-GRAOS-250' then 'Em Grãos'
         when 'ITAJAO-MOIDO-250' then 'Moído'
         when 'ITAJAO-KIT-1KG' then 'Kit · 2×500g'
       end,
       store_short_description = case sku
         when 'ITAJAO-GRAOS-500' then 'Café especial em grãos para moer na hora e aproveitar o máximo de aroma e frescor.'
         when 'ITAJAO-MOIDO-500' then 'A praticidade do café já moído sem abrir mão do perfil especial do Itajaó.'
         when 'ITAJAO-GRAOS-250' then 'Formato compacto em grãos, ideal para experimentar o lote e moer cada dose na hora.'
         when 'ITAJAO-MOIDO-250' then 'Uma porta de entrada prática para conhecer o Itajaó já moído.'
         when 'ITAJAO-KIT-1KG' then 'Dois pacotes de 500g para completar 1kg de Café Especial Itajaó.'
       end,
       store_description = case sku
         when 'ITAJAO-GRAOS-500' then 'Produzido na Fazenda Itajaó, este lote de 500g em grãos preserva o café inteiro até o preparo e permite ajustar a moagem ao método preferido.'
         when 'ITAJAO-MOIDO-500' then 'A versão de 500g moída foi pensada para o preparo prático do dia a dia, mantendo notas de chocolate, caramelo e castanha.'
         when 'ITAJAO-GRAOS-250' then 'O pacote de 250g em grãos traz o mesmo lote especial Itajaó em uma quantidade menor e mantém a flexibilidade de moagem.'
         when 'ITAJAO-MOIDO-250' then 'O pacote de 250g moído reúne praticidade, torra média e notas naturais de chocolate, caramelo e castanha.'
         when 'ITAJAO-KIT-1KG' then 'O kit de 1kg reúne dois pacotes de 500g do Café Especial Itajaó para quem quer manter o café fresco por mais tempo.'
       end,
       store_images = case sku
         when 'ITAJAO-GRAOS-500' then '["assets/images/products/500graos.png"]'::jsonb
         when 'ITAJAO-MOIDO-500' then '["assets/images/products/500moido.png"]'::jsonb
         when 'ITAJAO-GRAOS-250' then '["assets/images/products/250graos.png"]'::jsonb
         when 'ITAJAO-MOIDO-250' then '["assets/images/products/250moido.png"]'::jsonb
         when 'ITAJAO-KIT-1KG' then '["assets/images/products/500graos.png","assets/images/products/500moido.png"]'::jsonb
       end,
       store_legacy_url = case sku
         when 'ITAJAO-GRAOS-500' then 'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-500g-graos-torra-media-100-arabica-sul-de-minas-itajao/'
         when 'ITAJAO-MOIDO-500' then 'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-500g-moido-torra-media-100-arabica-sul-de-minas-itajao/'
         when 'ITAJAO-GRAOS-250' then 'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-250g-graos-torra-media-100-arabica-sul-de-minas-itajao/'
         when 'ITAJAO-MOIDO-250' then 'https://cafeitajao.com.br/produtos/cafe-especial-84-pontos-sca-250g-moido-torra-media-100-arabica-sul-de-minas-itajao/'
         when 'ITAJAO-KIT-1KG' then 'https://cafeitajao.com.br/produtos/kit-1kg-cafe-especial-84-pontos-sca-torra-media-100-arabica-sul-de-minas-itajao/'
       end,
       shipping_width_cm = 20,
       shipping_height_cm = 20,
       shipping_length_cm = 20,
       package_env_key = case sku
         when 'ITAJAO-GRAOS-500' then 'GRAOS500'
         when 'ITAJAO-MOIDO-500' then 'MOIDO500'
         when 'ITAJAO-GRAOS-250' then 'GRAOS250'
         when 'ITAJAO-MOIDO-250' then 'MOIDO250'
         when 'ITAJAO-KIT-1KG' then 'KIT1KG'
       end,
       bling_env_key = case sku
         when 'ITAJAO-GRAOS-500' then 'BLING_PRODUCT_GRAOS500_ID'
         when 'ITAJAO-MOIDO-500' then 'BLING_PRODUCT_MOIDO500_ID'
         when 'ITAJAO-GRAOS-250' then 'BLING_PRODUCT_GRAOS250_ID'
         when 'ITAJAO-MOIDO-250' then 'BLING_PRODUCT_MOIDO250_ID'
         when 'ITAJAO-KIT-1KG' then 'BLING_PRODUCT_KIT1KG_ID'
       end
  from canonical c
 where p.id = c.id
   and c.store_rank = 1;

create table if not exists public.store_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  discount_type text not null
    check (discount_type in ('percent','fixed','free_shipping')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  minimum_subtotal numeric(12,2) not null default 0 check (minimum_subtotal >= 0),
  maximum_discount numeric(12,2) check (maximum_discount is null or maximum_discount >= 0),
  first_purchase_only boolean not null default false,
  total_usage_limit integer check (total_usage_limit is null or total_usage_limit > 0),
  per_customer_limit integer check (per_customer_limit is null or per_customer_limit > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,30}$')
);

create unique index if not exists store_coupons_code_uidx
  on public.store_coupons (code);

create table if not exists public.store_coupon_redemptions (
  id bigint generated by default as identity primary key,
  coupon_id uuid not null references public.store_coupons(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  created_at timestamptz not null default now()
);

create index if not exists store_coupon_redemptions_coupon_idx
  on public.store_coupon_redemptions (coupon_id, created_at desc);
create index if not exists store_coupon_redemptions_customer_idx
  on public.store_coupon_redemptions (customer_id, created_at desc);

alter table public.store_coupons enable row level security;
alter table public.store_coupon_redemptions enable row level security;
revoke all on table public.store_coupons from public, anon, authenticated;
revoke all on table public.store_coupon_redemptions from public, anon, authenticated;

insert into public.store_coupons (
  code, name, discount_type, discount_value, minimum_subtotal,
  maximum_discount, first_purchase_only, per_customer_limit, active
)
values (
  'BEMVINDO10', '10% na primeira compra', 'percent', 10, 0,
  null, true, 1, true
)
on conflict (code) do nothing;

alter table public.site_order_integrations
  add column if not exists coupon_code text,
  add column if not exists discount_amount numeric(12,2) not null default 0;

-- Nova assinatura do checkout. A versão anterior continua disponível durante
-- a transição para que a publicação da migration não interrompa o código atual.
create or replace function public.create_site_checkout_order(
  p_customer jsonb,
  p_address jsonb,
  p_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_coupon_code text,
  p_shipping_amount numeric,
  p_shipping_cost numeric,
  p_shipping_service_id integer,
  p_shipping_service_name text,
  p_shipping_carrier text,
  p_shipping_quote jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel_id uuid;
  v_customer_id uuid;
  v_order_id uuid := gen_random_uuid();
  v_public_token uuid := gen_random_uuid();
  v_order_number text;
  v_document text := regexp_replace(coalesce(p_customer->>'document', ''), '[^0-9]', '', 'g');
  v_email text := lower(trim(coalesce(p_customer->>'email', '')));
  v_item jsonb;
  v_product_id uuid;
  v_product_cost numeric;
  v_sku text;
  v_quantity integer;
  v_unit_price numeric;
  v_coupon_code text := nullif(upper(trim(coalesce(p_coupon_code, ''))), '');
  v_coupon public.store_coupons%rowtype;
  v_discount numeric(12,2) := 0;
  v_coupon_uses bigint := 0;
  v_customer_coupon_uses bigint := 0;
  v_total numeric(12,2);
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pedido sem itens';
  end if;

  if coalesce(p_subtotal, -1) < 0
     or coalesce(p_shipping_amount, -1) < 0
     or coalesce(p_shipping_cost, -1) < 0
     or coalesce(p_discount_amount, -1) < 0 then
    raise exception 'Valores do pedido inválidos';
  end if;

  perform pg_advisory_xact_lock(hashtext('itajao:sales-channel:site')::bigint);
  select id into v_channel_id
    from public.sales_channels
   where lower(name) = 'site'
   order by active desc, created_at asc
   limit 1;

  if v_channel_id is null then
    insert into public.sales_channels (name, channel_type)
    values ('Site', 'loja_virtual')
    returning id into v_channel_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('itajao:customer:' || coalesce(nullif(v_document, ''), v_email))::bigint
  );

  if v_document <> '' then
    select id into v_customer_id
      from public.customers
     where regexp_replace(coalesce(cpf_cnpj, ''), '[^0-9]', '', 'g') = v_document
     order by active desc, created_at asc
     limit 1;
  end if;

  if v_customer_id is null and v_email <> '' then
    select id into v_customer_id
      from public.customers
     where lower(coalesce(email, '')) = v_email
     order by active desc, created_at asc
     limit 1;
  end if;

  if v_customer_id is null then
    insert into public.customers (
      customer_type, full_name, company_name, cpf_cnpj, phone, email,
      city, state, postal_code, address_line, address_number,
      address_complement, neighborhood, source_channel_id, active
    ) values (
      case when length(v_document) = 14 then 'empresa' else 'pessoa_fisica' end,
      p_customer->>'name',
      case when length(v_document) = 14 then p_customer->>'name' else null end,
      nullif(v_document, ''), p_customer->>'phone', nullif(v_email, ''),
      p_address->>'city', p_address->>'state', p_address->>'postalCode',
      p_address->>'street', p_address->>'number', nullif(p_address->>'complement', ''),
      p_address->>'district', v_channel_id, true
    ) returning id into v_customer_id;
  else
    update public.customers
       set full_name = p_customer->>'name',
           customer_type = case when length(v_document) = 14 then 'empresa' else 'pessoa_fisica' end,
           company_name = case when length(v_document) = 14 then coalesce(company_name, p_customer->>'name') else company_name end,
           cpf_cnpj = nullif(v_document, ''),
           phone = p_customer->>'phone',
           email = nullif(v_email, ''),
           city = p_address->>'city',
           state = p_address->>'state',
           postal_code = p_address->>'postalCode',
           address_line = p_address->>'street',
           address_number = p_address->>'number',
           address_complement = nullif(p_address->>'complement', ''),
           neighborhood = p_address->>'district',
           source_channel_id = coalesce(source_channel_id, v_channel_id),
           active = true,
           updated_at = now()
     where id = v_customer_id;
  end if;

  if v_coupon_code is not null then
    select * into v_coupon
      from public.store_coupons
     where code = v_coupon_code
       and active = true
     for update;

    if v_coupon.id is null then
      raise exception 'Cupom inválido ou inativo';
    end if;
    if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
      raise exception 'Este cupom ainda não está disponível';
    end if;
    if v_coupon.ends_at is not null and now() >= v_coupon.ends_at then
      raise exception 'Este cupom expirou';
    end if;
    if p_subtotal < v_coupon.minimum_subtotal then
      raise exception 'O valor mínimo deste cupom é R$ %', to_char(v_coupon.minimum_subtotal, 'FM999G999G990D00');
    end if;

    select count(*) into v_coupon_uses
      from public.store_coupon_redemptions r
      join public.orders o on o.id = r.order_id
     where r.coupon_id = v_coupon.id
       and coalesce(o.payment_status, '') not in ('cancelado', 'reembolsado')
       and (
         o.payment_status = 'pago'
         or r.created_at >= now() - interval '30 minutes'
       );

    if v_coupon.total_usage_limit is not null
       and v_coupon_uses >= v_coupon.total_usage_limit then
      raise exception 'Este cupom atingiu o limite de utilizações';
    end if;

    if v_coupon.first_purchase_only and exists (
      select 1 from public.orders o
       where o.customer_id = v_customer_id
         and o.payment_status = 'pago'
    ) then
      raise exception 'Este cupom é exclusivo para a primeira compra';
    end if;

    select count(*) into v_customer_coupon_uses
      from public.store_coupon_redemptions r
      join public.orders o on o.id = r.order_id
     where r.coupon_id = v_coupon.id
       and r.customer_id = v_customer_id
       and coalesce(o.payment_status, '') not in ('cancelado', 'reembolsado')
       and (
         o.payment_status = 'pago'
         or r.created_at >= now() - interval '30 minutes'
       );

    if v_coupon.per_customer_limit is not null
       and v_customer_coupon_uses >= v_coupon.per_customer_limit then
      raise exception 'Este cupom já foi utilizado por este cliente';
    end if;

    v_discount := case v_coupon.discount_type
      when 'percent' then round((p_subtotal * v_coupon.discount_value / 100)::numeric, 2)
      when 'fixed' then least(p_subtotal, v_coupon.discount_value)
      else 0
    end;

    if v_coupon.maximum_discount is not null then
      v_discount := least(v_discount, v_coupon.maximum_discount);
    end if;
    v_discount := least(p_subtotal, greatest(0, v_discount));

    if abs(v_discount - p_discount_amount) > 0.01 then
      raise exception 'O desconto do cupom mudou. Atualize o carrinho';
    end if;
  elsif p_discount_amount <> 0 then
    raise exception 'Desconto sem cupom válido';
  end if;

  v_total := round((p_subtotal - v_discount + p_shipping_amount)::numeric, 2);
  if v_total < 0 then
    raise exception 'Total do pedido inválido';
  end if;

  v_order_number := 'SITE-'
    || to_char(clock_timestamp() at time zone 'America/Sao_Paulo', 'YYYYMMDD-HH24MISS')
    || '-'
    || upper(left(replace(v_order_id::text, '-', ''), 6));

  insert into public.orders (
    id, customer_id, channel_id, external_order_number, order_date,
    payment_status, subtotal, discount_amount, shipping_amount, notes
  ) values (
    v_order_id, v_customer_id, v_channel_id, v_order_number, now(),
    'pendente', p_subtotal, v_discount, p_shipping_amount,
    'Pedido criado automaticamente pelo checkout do site Itajaó.'
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_sku := trim(coalesce(v_item->>'sku', ''));
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unitPrice')::numeric;

    if v_sku = '' or v_quantity < 1 or v_unit_price < 0 then
      raise exception 'Item do pedido inválido';
    end if;

    perform pg_advisory_xact_lock(hashtext('itajao:product:' || v_sku)::bigint);
    select id, cost_price into v_product_id, v_product_cost
      from public.products
     where sku = v_sku
     order by active desc, created_at asc
     limit 1;

    if v_product_id is null then
      insert into public.products (sku, name, weight_grams, sale_price, active)
      values (
        v_sku, v_item->>'name', nullif(v_item->>'weightGrams', '')::integer,
        v_unit_price, true
      )
      returning id, cost_price into v_product_id, v_product_cost;
    end if;

    insert into public.order_items (
      order_id, product_id, product_name, quantity, unit_price, unit_cost
    ) values (
      v_order_id, v_product_id, v_item->>'name', v_quantity,
      v_unit_price, v_product_cost
    );
  end loop;

  insert into public.site_order_integrations (
    order_id, public_token, checkout_status, customer_snapshot,
    delivery_address, shipping_cost, shipping_service_id,
    shipping_service_name, shipping_carrier, shipping_quote,
    coupon_code, discount_amount
  ) values (
    v_order_id, v_public_token, 'awaiting_payment', p_customer,
    p_address, p_shipping_cost, p_shipping_service_id,
    p_shipping_service_name, p_shipping_carrier, p_shipping_quote,
    v_coupon_code, v_discount
  );

  if v_coupon.id is not null then
    insert into public.store_coupon_redemptions (
      coupon_id, order_id, customer_id, discount_amount
    ) values (
      v_coupon.id, v_order_id, v_customer_id, v_discount
    );
  end if;

  return jsonb_build_object(
    'id', v_order_id,
    'public_token', v_public_token,
    'order_number', v_order_number,
    'customer_id', v_customer_id,
    'channel_id', v_channel_id,
    'subtotal', p_subtotal,
    'discount_amount', v_discount,
    'shipping_amount', p_shipping_amount,
    'coupon_code', v_coupon_code,
    'total', v_total
  );
end;
$$;

revoke all on function public.create_site_checkout_order(
  jsonb,jsonb,jsonb,numeric,numeric,text,numeric,numeric,integer,text,text,jsonb
) from public, anon, authenticated;
grant execute on function public.create_site_checkout_order(
  jsonb,jsonb,jsonb,numeric,numeric,text,numeric,numeric,integer,text,text,jsonb
) to service_role;

commit;
