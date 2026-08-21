begin;

create table if not exists public.internal_dispatch_secrets (
  name text primary key,
  secret_value text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

comment on table public.internal_dispatch_secrets is
  'Segredos internos usados apenas por tarefas agendadas e funções com service role.';

alter table public.internal_dispatch_secrets enable row level security;
revoke all on table public.internal_dispatch_secrets from public, anon, authenticated;
grant select on table public.internal_dispatch_secrets to service_role;

insert into public.internal_dispatch_secrets (name, secret_value)
values ('crm-notification-dispatch', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

do $$
declare
  existing_job bigint;
begin
  select jobid
    into existing_job
    from cron.job
   where jobname = 'crm-itajao-notifications-dispatch';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end;
$$;

select cron.schedule(
  'crm-itajao-notifications-dispatch',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://eumgdopgiffzpahzcdsq.supabase.co/functions/v1/crm-notification-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          select secret_value
            from public.internal_dispatch_secrets
           where name = 'crm-notification-dispatch'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$
);

commit;
