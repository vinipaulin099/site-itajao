-- ITAJAÓ CAFÉS ESPECIAIS — base de inscritos da newsletter
-- Execute uma vez no SQL Editor do Supabase usado pelo site.

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  email text not null unique check (email = lower(email) and char_length(email) between 5 and 180),
  source text not null default 'popup_site_itajao',
  created_at timestamptz not null default now()
);

alter table public.newsletter_subscribers enable row level security;

drop policy if exists newsletter_public_insert on public.newsletter_subscribers;
create policy newsletter_public_insert
on public.newsletter_subscribers
for insert
to anon, authenticated
with check (true);

grant insert on table public.newsletter_subscribers to anon, authenticated;

-- Não há política de SELECT/UPDATE/DELETE para visitantes do site.
-- A lista permanece acessível apenas pelo painel/credenciais administrativas do Supabase.
