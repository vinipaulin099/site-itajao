begin;

create table if not exists public.subscription_offers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plan_type text not null check (plan_type in ('monthly', 'annual')),
  weight_grams integer not null check (weight_grams in (500, 1000)),
  name text not null,
  unit_price_cents integer not null check (unit_price_cents > 0),
  billing_cycle_limit integer check (billing_cycle_limit is null or billing_cycle_limit > 0),
  pix_discount_bps integer not null default 500 check (pix_discount_bps between 0 and 10000),
  free_shipping boolean not null default true,
  coupon_eligible boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_type, weight_grams),
  check (
    (plan_type = 'monthly' and billing_cycle_limit is null)
    or (plan_type = 'annual' and billing_cycle_limit = 12)
  ),
  check (free_shipping = true),
  check (coupon_eligible = false)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null unique default gen_random_uuid(),
  subscription_number text not null unique,
  client_request_id uuid not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  offer_id uuid not null references public.subscription_offers(id) on delete restrict,
  plan_type text not null check (plan_type in ('monthly', 'annual')),
  weight_grams integer not null check (weight_grams in (500, 1000)),
  coffee_format text not null check (coffee_format in ('beans', 'ground')),
  billing_method text not null check (billing_method in ('recurring', 'pix')),
  status text not null default 'checkout_pending' check (
    status in (
      'checkout_pending', 'active', 'past_due', 'paused', 'completed',
      'cancelled', 'checkout_error', 'refunded'
    )
  ),
  unit_price_cents integer not null check (unit_price_cents > 0),
  billing_cycle_limit integer check (billing_cycle_limit is null or billing_cycle_limit > 0),
  billing_cycles_paid integer not null default 0 check (billing_cycles_paid >= 0),
  original_total_cents integer not null check (original_total_cents > 0),
  discount_bps integer not null default 0 check (discount_bps between 0 and 10000),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_amount_cents integer not null check (total_amount_cents > 0),
  shipping_amount_cents integer not null default 0 check (shipping_amount_cents = 0),
  coupon_code text,
  customer_snapshot jsonb not null default '{}'::jsonb,
  delivery_address jsonb not null default '{}'::jsonb,
  mp_preapproval_id text unique,
  mp_preference_id text unique,
  mp_initial_payment_id text unique,
  mp_status text,
  checkout_url text,
  terms_accepted_at timestamptz not null,
  terms_version text not null check (char_length(terms_version) between 3 and 80),
  starts_at timestamptz,
  ends_at timestamptz,
  next_payment_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coupon_code is null),
  check (original_total_cents - discount_cents = total_amount_cents),
  check (
    (billing_method = 'pix' and discount_bps = 500)
    or (billing_method = 'recurring' and discount_bps = 0 and discount_cents = 0)
  ),
  check (
    (plan_type = 'monthly' and billing_cycle_limit is null)
    or (plan_type = 'annual' and billing_cycle_limit = 12)
  )
);

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  cycle_number integer not null check (cycle_number > 0),
  provider text not null default 'mercadopago',
  provider_payment_id text not null,
  provider_authorized_payment_id text,
  payment_method text not null default 'unknown',
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  raw_status text,
  amount_cents integer not null check (amount_cents >= 0),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create table if not exists public.subscription_shipments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  payment_id uuid references public.subscription_payments(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  shipment_number integer not null check (shipment_number > 0),
  coffee_format text not null check (coffee_format in ('beans', 'ground')),
  status text not null default 'planned' check (
    status in ('planned', 'deferred', 'preparing', 'shipped', 'delivered', 'cancelled')
  ),
  original_scheduled_for date not null,
  scheduled_for date not null,
  pause_count integer not null default 0 check (pause_count >= 0),
  reward_code text check (reward_code is null or reward_code in ('third_shipment', 'sixth_shipment', 'twelfth_shipment')),
  tracking_code text,
  label_url text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, shipment_number)
);

create table if not exists public.subscription_events (
  id bigint generated always as identity primary key,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text not null,
  event_type text not null,
  external_id text not null,
  ok boolean not null default true,
  detail text,
  created_at timestamptz not null default now(),
  unique (provider, event_type, external_id)
);

create table if not exists public.subscription_benefit_coupons (
  subscription_id uuid primary key references public.subscriptions(id) on delete cascade,
  coupon_id uuid not null unique references public.store_coupons(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  code text not null unique check (code = upper(code) and code ~ '^CLUBE[A-Z0-9]{8,20}$'),
  created_at timestamptz not null default now()
);

create index if not exists subscriptions_customer_created_idx
  on public.subscriptions (customer_id, created_at desc);
create index if not exists subscriptions_status_created_idx
  on public.subscriptions (status, created_at desc);
create index if not exists subscriptions_offer_id_idx
  on public.subscriptions (offer_id);
create index if not exists subscriptions_next_payment_idx
  on public.subscriptions (next_payment_at)
  where status in ('active', 'past_due') and next_payment_at is not null;
create index if not exists subscription_payments_subscription_created_idx
  on public.subscription_payments (subscription_id, created_at desc);
create unique index if not exists subscription_payments_paid_cycle_uidx
  on public.subscription_payments (subscription_id, cycle_number)
  where status = 'paid';
create unique index if not exists subscription_payments_authorized_payment_uidx
  on public.subscription_payments (provider, provider_authorized_payment_id)
  where provider_authorized_payment_id is not null;
create index if not exists subscription_shipments_schedule_idx
  on public.subscription_shipments (status, scheduled_for);
create index if not exists subscription_shipments_payment_id_idx
  on public.subscription_shipments (payment_id);
create index if not exists subscription_shipments_order_id_idx
  on public.subscription_shipments (order_id);
create index if not exists subscription_events_subscription_created_idx
  on public.subscription_events (subscription_id, created_at desc);
create index if not exists subscription_benefit_coupons_customer_idx
  on public.subscription_benefit_coupons (customer_id);

drop trigger if exists subscription_offers_set_updated_at on public.subscription_offers;
create trigger subscription_offers_set_updated_at
before update on public.subscription_offers
for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists subscription_payments_set_updated_at on public.subscription_payments;
create trigger subscription_payments_set_updated_at
before update on public.subscription_payments
for each row execute function public.set_updated_at();

drop trigger if exists subscription_shipments_set_updated_at on public.subscription_shipments;
create trigger subscription_shipments_set_updated_at
before update on public.subscription_shipments
for each row execute function public.set_updated_at();

create or replace function public.enforce_subscription_benefit_coupon()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer_id uuid;
  v_status text;
  v_ends_at timestamptz;
begin
  select benefit.customer_id, subscription.status, subscription.ends_at
    into v_customer_id, v_status, v_ends_at
    from public.subscription_benefit_coupons benefit
    join public.subscriptions subscription on subscription.id = benefit.subscription_id
   where benefit.coupon_id = new.coupon_id;

  if found then
    if new.customer_id <> v_customer_id then
      raise exception 'Cupom exclusivo do titular da assinatura';
    end if;
    if v_status <> 'active' or (v_ends_at is not null and now() >= v_ends_at) then
      raise exception 'Benefício disponível apenas durante a assinatura ativa';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists store_coupon_redemptions_enforce_subscription_benefit
  on public.store_coupon_redemptions;
create trigger store_coupon_redemptions_enforce_subscription_benefit
before insert or update of coupon_id, customer_id on public.store_coupon_redemptions
for each row execute function public.enforce_subscription_benefit_coupon();

create or replace function public.sync_subscription_benefit_coupon()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.store_coupons coupon
     set active = (
           new.status = 'active'
           and (new.ends_at is null or now() < new.ends_at)
         ),
         ends_at = new.ends_at,
         updated_at = now()
    from public.subscription_benefit_coupons benefit
   where benefit.subscription_id = new.id
     and coupon.id = benefit.coupon_id;
  return new;
end;
$$;

drop trigger if exists subscriptions_sync_benefit_coupon on public.subscriptions;
create trigger subscriptions_sync_benefit_coupon
after update of status, ends_at on public.subscriptions
for each row execute function public.sync_subscription_benefit_coupon();

insert into public.subscription_offers (
  code, plan_type, weight_grams, name, unit_price_cents,
  billing_cycle_limit, pix_discount_bps, free_shipping, coupon_eligible, active
) values
  ('monthly-500', 'monthly', 500, 'Clube Itajaó Mensal 500g', 8890, null, 500, true, false, true),
  ('monthly-1000', 'monthly', 1000, 'Clube Itajaó Mensal 1kg', 14990, null, 500, true, false, true),
  ('annual-500', 'annual', 500, 'Clube Itajaó Anual 500g', 7490, 12, 500, true, false, true),
  ('annual-1000', 'annual', 1000, 'Clube Itajaó Anual 1kg', 13690, 12, 500, true, false, true)
on conflict (plan_type, weight_grams) do update
set code = excluded.code,
    name = excluded.name,
    unit_price_cents = excluded.unit_price_cents,
    billing_cycle_limit = excluded.billing_cycle_limit,
    pix_discount_bps = excluded.pix_discount_bps,
    free_shipping = true,
    coupon_eligible = false,
    active = true,
    updated_at = now();

create or replace function public.create_subscription_checkout(
  p_customer jsonb,
  p_address jsonb,
  p_plan_type text,
  p_weight_grams integer,
  p_coffee_format text,
  p_billing_method text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel_id uuid;
  v_customer_id uuid;
  v_offer public.subscription_offers%rowtype;
  v_existing public.subscriptions%rowtype;
  v_subscription_id uuid := gen_random_uuid();
  v_public_token uuid := gen_random_uuid();
  v_subscription_number text;
  v_document text := regexp_replace(coalesce(p_customer->>'document', ''), '[^0-9]', '', 'g');
  v_email text := lower(trim(coalesce(p_customer->>'email', '')));
  v_periods integer;
  v_original_total integer;
  v_discount_bps integer;
  v_final_total integer;
  v_discount integer;
begin
  if p_plan_type not in ('monthly', 'annual') then
    raise exception 'Plano de assinatura inválido';
  end if;
  if p_weight_grams not in (500, 1000) then
    raise exception 'Peso de assinatura inválido';
  end if;
  if p_coffee_format not in ('beans', 'ground') then
    raise exception 'Formato de café inválido';
  end if;
  if p_billing_method not in ('recurring', 'pix') then
    raise exception 'Forma de pagamento inválida';
  end if;
  if p_client_request_id is null then
    raise exception 'Identificador da tentativa ausente';
  end if;
  if v_document = '' or v_email = '' then
    raise exception 'Cliente incompleto';
  end if;

  select * into v_offer
    from public.subscription_offers
   where plan_type = p_plan_type
     and weight_grams = p_weight_grams
     and active = true
   for share;

  if v_offer.id is null then
    raise exception 'Esta assinatura não está disponível';
  end if;
  if not v_offer.free_shipping or v_offer.coupon_eligible then
    raise exception 'Configuração comercial da assinatura inválida';
  end if;

  v_periods := case when p_plan_type = 'annual' then 12 else 1 end;
  v_original_total := v_offer.unit_price_cents * v_periods;
  v_discount_bps := case when p_billing_method = 'pix' then v_offer.pix_discount_bps else 0 end;
  v_final_total := round(v_original_total::numeric * (10000 - v_discount_bps) / 10000)::integer;
  v_discount := v_original_total - v_final_total;

  perform pg_advisory_xact_lock(hashtext('itajao:subscription-request:' || p_client_request_id::text)::bigint);
  select * into v_existing
    from public.subscriptions
   where client_request_id = p_client_request_id
   for update;

  if v_existing.id is not null then
    return jsonb_build_object(
      'id', v_existing.id,
      'public_token', v_existing.public_token,
      'subscription_number', v_existing.subscription_number,
      'customer_id', v_existing.customer_id,
      'offer_id', v_existing.offer_id,
      'offer_name', v_offer.name,
      'plan_type', v_existing.plan_type,
      'weight_grams', v_existing.weight_grams,
      'coffee_format', v_existing.coffee_format,
      'billing_method', v_existing.billing_method,
      'unit_price_cents', v_existing.unit_price_cents,
      'billing_cycle_limit', v_existing.billing_cycle_limit,
      'original_total_cents', v_existing.original_total_cents,
      'discount_bps', v_existing.discount_bps,
      'discount_cents', v_existing.discount_cents,
      'total_amount_cents', v_existing.total_amount_cents,
      'shipping_amount_cents', v_existing.shipping_amount_cents,
      'coupon_eligible', false,
      'checkout_url', v_existing.checkout_url
    );
  end if;

  perform pg_advisory_xact_lock(hashtext('itajao:sales-channel:subscription')::bigint);
  select id into v_channel_id
    from public.sales_channels
   where lower(name) = 'assinatura'
   order by active desc, created_at asc
   limit 1;

  if v_channel_id is null then
    insert into public.sales_channels (name, channel_type)
    values ('Assinatura', 'loja_virtual')
    returning id into v_channel_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('itajao:customer:' || coalesce(nullif(v_document, ''), v_email))::bigint
  );

  select id into v_customer_id
    from public.customers
   where regexp_replace(coalesce(cpf_cnpj, ''), '[^0-9]', '', 'g') = v_document
   order by active desc, created_at asc
   limit 1;

  if v_customer_id is null then
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
      v_document, p_customer->>'phone', v_email,
      p_address->>'city', p_address->>'state', p_address->>'postalCode',
      p_address->>'street', p_address->>'number', nullif(p_address->>'complement', ''),
      p_address->>'district', v_channel_id, true
    ) returning id into v_customer_id;
  else
    update public.customers
       set full_name = p_customer->>'name',
           customer_type = case when length(v_document) = 14 then 'empresa' else 'pessoa_fisica' end,
           company_name = case when length(v_document) = 14 then coalesce(company_name, p_customer->>'name') else company_name end,
           cpf_cnpj = v_document,
           phone = p_customer->>'phone',
           email = v_email,
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

  v_subscription_number := 'CLUBE-'
    || to_char(clock_timestamp() at time zone 'America/Sao_Paulo', 'YYYYMMDD-HH24MISS')
    || '-'
    || upper(left(replace(v_subscription_id::text, '-', ''), 6));

  insert into public.subscriptions (
    id, public_token, subscription_number, client_request_id, customer_id, offer_id,
    plan_type, weight_grams, coffee_format, billing_method, status,
    unit_price_cents, billing_cycle_limit, original_total_cents,
    discount_bps, discount_cents, total_amount_cents,
    shipping_amount_cents, coupon_code, customer_snapshot, delivery_address,
    terms_accepted_at, terms_version
  ) values (
    v_subscription_id, v_public_token, v_subscription_number, p_client_request_id, v_customer_id, v_offer.id,
    p_plan_type, p_weight_grams, p_coffee_format, p_billing_method, 'checkout_pending',
    v_offer.unit_price_cents, v_offer.billing_cycle_limit, v_original_total,
    v_discount_bps, v_discount, v_final_total,
    0, null, p_customer, p_address,
    now(), 'clube-itajao-2026-08-21'
  );

  return jsonb_build_object(
    'id', v_subscription_id,
    'public_token', v_public_token,
    'subscription_number', v_subscription_number,
    'customer_id', v_customer_id,
    'offer_id', v_offer.id,
    'offer_name', v_offer.name,
    'plan_type', p_plan_type,
    'weight_grams', p_weight_grams,
    'coffee_format', p_coffee_format,
    'billing_method', p_billing_method,
    'unit_price_cents', v_offer.unit_price_cents,
    'billing_cycle_limit', v_offer.billing_cycle_limit,
    'original_total_cents', v_original_total,
    'discount_bps', v_discount_bps,
    'discount_cents', v_discount,
    'total_amount_cents', v_final_total,
    'shipping_amount_cents', 0,
    'coupon_eligible', false
  );
end;
$$;

create or replace function public.record_subscription_payment(
  p_subscription_id uuid,
  p_provider_payment_id text,
  p_provider_authorized_payment_id text,
  p_raw_status text,
  p_amount_cents integer,
  p_paid_at timestamptz,
  p_payment_method text,
  p_next_payment_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_existing public.subscription_payments%rowtype;
  v_payment_id uuid;
  v_local_status text;
  v_cycle_number integer;
  v_expected_amount integer;
  v_became_paid boolean := false;
  v_next_shipment integer;
  v_shipments_created integer := 0;
  v_index integer;
  v_schedule date;
  v_reward text;
  v_benefit_coupon_id uuid;
  v_benefit_coupon_code text;
  v_benefit_ends_at timestamptz;
begin
  select * into v_subscription
    from public.subscriptions
   where id = p_subscription_id
   for update;

  if v_subscription.id is null then
    raise exception 'Assinatura não localizada';
  end if;
  if coalesce(trim(p_provider_payment_id), '') = '' then
    raise exception 'Pagamento sem identificador';
  end if;

  v_local_status := case
    when p_raw_status = 'approved' then 'paid'
    when p_raw_status in ('refunded', 'charged_back') then 'refunded'
    when p_raw_status in ('rejected', 'cancelled') then 'failed'
    else 'pending'
  end;
  v_expected_amount := case
    when v_subscription.billing_method = 'pix' then v_subscription.total_amount_cents
    else v_subscription.unit_price_cents
  end;

  if v_local_status = 'paid' and p_amount_cents <> v_expected_amount then
    raise exception 'Valor do pagamento divergente';
  end if;

  select * into v_existing
    from public.subscription_payments
   where provider = 'mercadopago'
     and (
       provider_payment_id = p_provider_payment_id
       or (
         nullif(p_provider_authorized_payment_id, '') is not null
         and provider_authorized_payment_id = p_provider_authorized_payment_id
       )
     )
   order by (provider_payment_id = p_provider_payment_id) desc
   limit 1
   for update;

  if v_existing.id is not null and v_existing.subscription_id <> p_subscription_id then
    raise exception 'Pagamento vinculado a outra assinatura';
  end if;

  if v_existing.id is null then
    select coalesce(max(cycle_number), 0) + 1 into v_cycle_number
      from public.subscription_payments
     where subscription_id = p_subscription_id
       and status = 'paid';

    insert into public.subscription_payments (
      subscription_id, cycle_number, provider, provider_payment_id,
      provider_authorized_payment_id, payment_method, status, raw_status,
      amount_cents, paid_at
    ) values (
      p_subscription_id, v_cycle_number, 'mercadopago', p_provider_payment_id,
      nullif(p_provider_authorized_payment_id, ''), coalesce(nullif(p_payment_method, ''), 'unknown'),
      v_local_status, p_raw_status, p_amount_cents,
      case when v_local_status = 'paid' then coalesce(p_paid_at, now()) else null end
    ) returning id into v_payment_id;
    v_became_paid := v_local_status = 'paid';
  else
    v_cycle_number := v_existing.cycle_number;
    v_payment_id := v_existing.id;
    if v_existing.status = 'paid' and v_local_status in ('pending', 'failed') then
      v_local_status := 'paid';
    end if;
    v_became_paid := v_local_status = 'paid' and v_existing.status <> 'paid';

    update public.subscription_payments
       set provider_payment_id = p_provider_payment_id,
           provider_authorized_payment_id = coalesce(nullif(p_provider_authorized_payment_id, ''), provider_authorized_payment_id),
           payment_method = coalesce(nullif(p_payment_method, ''), payment_method),
           status = v_local_status,
           raw_status = p_raw_status,
           amount_cents = p_amount_cents,
           paid_at = case when v_local_status = 'paid' then coalesce(p_paid_at, paid_at, now()) else paid_at end
     where id = v_existing.id;
  end if;

  if v_became_paid then
    if v_subscription.plan_type = 'annual' and v_subscription.billing_method = 'pix' then
      for v_index in 0..11 loop
        v_next_shipment := v_index + 1;
        v_schedule := (coalesce(p_paid_at, now())::date + make_interval(months => v_index))::date;
        v_reward := case v_next_shipment
          when 3 then 'third_shipment'
          when 6 then 'sixth_shipment'
          when 12 then 'twelfth_shipment'
          else null
        end;

        insert into public.subscription_shipments (
          subscription_id, payment_id, shipment_number, coffee_format,
          original_scheduled_for, scheduled_for, reward_code
        ) values (
          p_subscription_id, v_payment_id, v_next_shipment, v_subscription.coffee_format,
          v_schedule, v_schedule, v_reward
        ) on conflict (subscription_id, shipment_number) do nothing;
        if found then v_shipments_created := v_shipments_created + 1; end if;
      end loop;
    else
      select coalesce(max(shipment_number), 0) + 1 into v_next_shipment
        from public.subscription_shipments
       where subscription_id = p_subscription_id;

      if v_subscription.billing_cycle_limit is null or v_next_shipment <= v_subscription.billing_cycle_limit then
        v_schedule := coalesce(p_paid_at, now())::date;
        v_reward := case v_next_shipment
          when 3 then 'third_shipment'
          when 6 then 'sixth_shipment'
          when 12 then 'twelfth_shipment'
          else null
        end;

        insert into public.subscription_shipments (
          subscription_id, payment_id, shipment_number, coffee_format,
          original_scheduled_for, scheduled_for, reward_code
        ) values (
          p_subscription_id, v_payment_id, v_next_shipment, v_subscription.coffee_format,
          v_schedule, v_schedule, v_reward
        ) on conflict (subscription_id, shipment_number) do nothing;
        if found then v_shipments_created := 1; end if;
      end if;
    end if;

    v_benefit_coupon_code := 'CLUBE'
      || upper(left(replace(v_subscription.public_token::text, '-', ''), 16));
    v_benefit_ends_at := case
      when v_subscription.plan_type = 'annual'
        then coalesce(v_subscription.starts_at, p_paid_at, now()) + interval '12 months'
      when v_subscription.plan_type = 'monthly' and v_subscription.billing_method = 'pix'
        then coalesce(v_subscription.starts_at, p_paid_at, now()) + interval '1 month'
      else null
    end;

    insert into public.store_coupons (
      code, name, discount_type, discount_value, minimum_subtotal,
      maximum_discount, first_purchase_only, total_usage_limit,
      per_customer_limit, starts_at, ends_at, active
    ) values (
      v_benefit_coupon_code,
      'Benefício Clube Itajaó 10% · ' || v_subscription.subscription_number,
      'percent', 10, 0,
      null, false, null,
      null, coalesce(v_subscription.starts_at, p_paid_at, now()), v_benefit_ends_at, true
    )
    on conflict (code) do update
       set name = excluded.name,
           starts_at = least(public.store_coupons.starts_at, excluded.starts_at),
           ends_at = excluded.ends_at,
           active = true,
           updated_at = now()
    returning id into v_benefit_coupon_id;

    insert into public.subscription_benefit_coupons (
      subscription_id, coupon_id, customer_id, code
    ) values (
      p_subscription_id, v_benefit_coupon_id, v_subscription.customer_id, v_benefit_coupon_code
    )
    on conflict (subscription_id) do update
       set coupon_id = excluded.coupon_id,
           customer_id = excluded.customer_id,
           code = excluded.code;

    update public.subscriptions
       set status = 'active',
           billing_cycles_paid = greatest(
             billing_cycles_paid,
             case when plan_type = 'annual' and billing_method = 'pix' then 12 else v_cycle_number end
           ),
           starts_at = coalesce(starts_at, coalesce(p_paid_at, now())),
           ends_at = coalesce(
             ends_at,
             case
               when plan_type = 'annual' then coalesce(p_paid_at, now()) + interval '12 months'
               when plan_type = 'monthly' and billing_method = 'pix' then coalesce(p_paid_at, now()) + interval '1 month'
               else null
             end
           ),
           next_payment_at = case
             when billing_method = 'pix' then null
             when billing_cycle_limit is not null and v_cycle_number >= billing_cycle_limit then null
             else p_next_payment_at
           end,
           mp_status = p_raw_status
     where id = p_subscription_id;
  elsif v_local_status = 'refunded' then
    update public.subscriptions
       set status = 'refunded', mp_status = p_raw_status
     where id = p_subscription_id;
  elsif v_local_status = 'failed' then
    update public.subscriptions
       set status = case when billing_cycles_paid > 0 then 'past_due' else 'checkout_pending' end,
           mp_status = p_raw_status,
           next_payment_at = p_next_payment_at
     where id = p_subscription_id;
  else
    update public.subscriptions
       set mp_status = p_raw_status,
           next_payment_at = coalesce(p_next_payment_at, next_payment_at)
     where id = p_subscription_id;
  end if;

  return jsonb_build_object(
    'subscription_id', p_subscription_id,
    'payment_id', v_payment_id,
    'cycle_number', v_cycle_number,
    'payment_status', v_local_status,
    'became_paid', v_became_paid,
    'shipments_created', v_shipments_created,
    'benefit_coupon_code', v_benefit_coupon_code,
    'should_stop_recurring', (
      v_subscription.plan_type = 'annual'
      and v_subscription.billing_method = 'recurring'
      and v_local_status = 'paid'
      and v_cycle_number >= 12
    )
  );
end;
$$;

alter table public.subscription_offers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.subscription_shipments enable row level security;
alter table public.subscription_events enable row level security;
alter table public.subscription_benefit_coupons enable row level security;

revoke all on table public.subscription_offers from public, anon, authenticated;
revoke all on table public.subscriptions from public, anon, authenticated;
revoke all on table public.subscription_payments from public, anon, authenticated;
revoke all on table public.subscription_shipments from public, anon, authenticated;
revoke all on table public.subscription_events from public, anon, authenticated;
revoke all on table public.subscription_benefit_coupons from public, anon, authenticated;
grant select, insert, update, delete on table public.subscription_offers to service_role;
grant select, insert, update, delete on table public.subscriptions to service_role;
grant select, insert, update, delete on table public.subscription_payments to service_role;
grant select, insert, update, delete on table public.subscription_shipments to service_role;
grant select, insert, update, delete on table public.subscription_events to service_role;
grant select, insert, update, delete on table public.subscription_benefit_coupons to service_role;
grant usage, select on sequence public.subscription_events_id_seq to service_role;

revoke all on function public.enforce_subscription_benefit_coupon()
  from public, anon, authenticated;
revoke all on function public.sync_subscription_benefit_coupon()
  from public, anon, authenticated;

revoke all on function public.create_subscription_checkout(jsonb, jsonb, text, integer, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_subscription_checkout(jsonb, jsonb, text, integer, text, text, uuid)
  to service_role;

revoke all on function public.record_subscription_payment(uuid, text, text, text, integer, timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_subscription_payment(uuid, text, text, text, integer, timestamptz, text, timestamptz)
  to service_role;

commit;
