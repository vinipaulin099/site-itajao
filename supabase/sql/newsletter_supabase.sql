-- ITAJAÓ CAFÉS ESPECIAIS — base privada de inscritos da newsletter.
-- O navegador NÃO grava nesta tabela diretamente. O cadastro passa pela
-- Edge Function `newsletter-signup`, que usa a service role apenas no servidor.

create extension if not exists pgcrypto;

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  email text not null unique check (email = lower(email) and char_length(email) between 5 and 180),
  source text not null default 'popup_site_itajao',
  is_active boolean not null default true,
  consent_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Deixa o script idempotente caso a versão antiga da newsletter já tenha
-- sido executada antes desta atualização.
alter table public.newsletter_subscribers add column if not exists is_active boolean not null default true;
alter table public.newsletter_subscribers add column if not exists consent_at timestamptz not null default now();
alter table public.newsletter_subscribers add column if not exists unsubscribed_at timestamptz;
alter table public.newsletter_subscribers add column if not exists updated_at timestamptz not null default now();

alter table public.newsletter_subscribers enable row level security;

-- Remove a permissão antiga de INSERT direto pelo navegador. A service role
-- usada pela Edge Function continua capaz de gravar sem expor a lista.
drop policy if exists newsletter_public_insert on public.newsletter_subscribers;
revoke all on table public.newsletter_subscribers from anon, authenticated;

create or replace function public.touch_newsletter_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists newsletter_touch_updated_at on public.newsletter_subscribers;
create trigger newsletter_touch_updated_at
before update on public.newsletter_subscribers
for each row execute function public.touch_newsletter_updated_at();
