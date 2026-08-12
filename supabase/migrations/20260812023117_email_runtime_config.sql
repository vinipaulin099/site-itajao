-- Fallback privado para endereços operacionais. Os secrets das Edge Functions
-- continuam tendo prioridade; esta tabela evita que endereços internos sejam
-- gravados no repositório público ou que a fila pare quando um secret legado
-- ainda não tiver sido migrado.

create table if not exists public.email_runtime_config (
  singleton boolean primary key default true check (singleton),
  notification_email_to text not null
    check (notification_email_to = lower(notification_email_to)
      and notification_email_to ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  customer_email_from text not null check (char_length(customer_email_from) between 5 and 240),
  notification_email_from text not null check (char_length(notification_email_from) between 5 and 240),
  reply_to_email text not null
    check (reply_to_email = lower(reply_to_email)
      and reply_to_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_runtime_config enable row level security;
revoke all on table public.email_runtime_config from public, anon, authenticated;
grant select, insert, update, delete on table public.email_runtime_config to service_role;

drop trigger if exists email_runtime_config_touch_updated_at
  on public.email_runtime_config;
create trigger email_runtime_config_touch_updated_at
before update on public.email_runtime_config
for each row execute function public.touch_community_updated_at();

-- Os valores operacionais são provisionados como secrets ou por uma operação
-- privada de implantação. Nenhum destinatário ou remetente é versionado.
