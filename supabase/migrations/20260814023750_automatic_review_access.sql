-- Cada venda passa a receber automaticamente uma chave de avaliação.
-- Os valores puros ficam em uma tabela protegida por RLS e sem grants para
-- anon/authenticated. A validação pública continua usando somente os hashes.

alter table public.review_invites
  add column if not exists link_token text,
  add column if not exists access_code text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.review_invites'::regclass
       and conname = 'review_invites_link_token_format_check'
  ) then
    alter table public.review_invites
      add constraint review_invites_link_token_format_check
      check (
        link_token is null
        or link_token ~ '^[A-Za-z0-9_-]{40,80}$'
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.review_invites'::regclass
       and conname = 'review_invites_access_code_format_check'
  ) then
    alter table public.review_invites
      add constraint review_invites_access_code_format_check
      check (
        access_code is null
        or (
          access_code ~ '^[A-HJ-NP-Z2-9]{6}$'
          and access_code ~ '[A-HJ-NP-Z]'
          and access_code ~ '[2-9]'
        )
      );
  end if;
end;
$$;

create unique index if not exists review_invites_link_token_key
  on public.review_invites (link_token)
  where link_token is not null;

create unique index if not exists review_invites_one_open_code
  on public.review_invites (access_code)
  where status = 'pending' and access_code is not null;

alter table public.review_invites enable row level security;
revoke all on table public.review_invites from public, anon, authenticated;
grant select, insert, update, delete on table public.review_invites to service_role;

create or replace function public.ensure_review_invite(
  p_order_id uuid,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_customer_id uuid;
  v_invite_id uuid;
  v_token text;
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_attempt integer;
  v_index integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text, 0));

  select customer_id
    into v_customer_id
    from public.orders
   where id = p_order_id;

  if v_customer_id is null then
    raise exception 'Pedido sem cliente válido.';
  end if;

  update public.review_invites
     set status = case
       when expires_at <= now() then 'expired'
       else 'revoked'
     end
   where order_id = p_order_id
     and status = 'pending'
     and (
       expires_at <= now()
       or link_token is null
       or access_code is null
     );

  select id
    into v_invite_id
    from public.review_invites
   where order_id = p_order_id
     and status = 'pending'
     and expires_at > now()
     and link_token is not null
     and access_code is not null
   order by created_at desc
   limit 1;

  if v_invite_id is not null then
    return v_invite_id;
  end if;

  for v_attempt in 1..10 loop
    loop
      v_code := '';
      for v_index in 1..6 loop
        v_code := v_code || substr(
          v_alphabet,
          1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alphabet)),
          1
        );
      end loop;
      exit when v_code ~ '[A-HJ-NP-Z]' and v_code ~ '[2-9]';
    end loop;

    v_token := rtrim(
      translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
      '='
    );

    begin
      insert into public.review_invites (
        order_id,
        customer_id,
        link_token_hash,
        code_hash,
        link_token,
        access_code,
        status,
        attempts,
        max_attempts,
        expires_at,
        created_by
      ) values (
        p_order_id,
        v_customer_id,
        encode(extensions.digest(v_token, 'sha256'), 'hex'),
        encode(extensions.digest(v_token || ':' || v_code, 'sha256'), 'hex'),
        v_token,
        v_code,
        'pending',
        0,
        5,
        now() + interval '30 days',
        p_created_by
      )
      returning id into v_invite_id;

      return v_invite_id;
    exception when unique_violation then
      -- Uma colisão é improvável, mas não deve impedir o registro da venda.
      null;
    end;
  end loop;

  raise exception 'Não foi possível gerar uma chave de avaliação única.';
end;
$$;

revoke all on function public.ensure_review_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_review_invite(uuid, uuid) to service_role;

create or replace function public.orders_ensure_review_invite()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  perform public.ensure_review_invite(new.id, new.created_by);
  return new;
end;
$$;

revoke all on function public.orders_ensure_review_invite() from public, anon, authenticated;

drop trigger if exists orders_ensure_review_invite on public.orders;
create trigger orders_ensure_review_invite
after insert on public.orders
for each row execute function public.orders_ensure_review_invite();

-- Pedidos pagos já existentes também recebem uma chave, sem enviar mensagem.
select public.ensure_review_invite(order_row.id, order_row.created_by)
  from public.orders as order_row
 where order_row.payment_status = 'pago'
   and order_row.status not in ('cancelado', 'reembolsado')
   and not exists (
     select 1
       from public.review_invites as invite
      where invite.order_id = order_row.id
        and invite.status = 'pending'
        and invite.expires_at > now()
        and invite.link_token is not null
        and invite.access_code is not null
   );
