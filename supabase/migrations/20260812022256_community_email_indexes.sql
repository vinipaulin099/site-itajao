-- Índices nas colunas que referenciam outras tabelas. Além de acelerar joins,
-- eles evitam varreduras completas quando um registro relacionado é alterado
-- ou removido.

create index if not exists email_events_outbox_idx
  on public.email_events (outbox_id);

create index if not exists email_outbox_related_customer_idx
  on public.email_outbox (related_customer_id);

create index if not exists product_reviews_customer_idx
  on public.product_reviews (customer_id);

create index if not exists product_reviews_invite_idx
  on public.product_reviews (invite_id);

create index if not exists product_reviews_moderated_by_idx
  on public.product_reviews (moderated_by);

create index if not exists product_reviews_order_idx
  on public.product_reviews (order_id);

create index if not exists recipe_submissions_customer_idx
  on public.recipe_submissions (customer_id);

create index if not exists recipe_submissions_moderated_by_idx
  on public.recipe_submissions (moderated_by);

create index if not exists review_invites_created_by_idx
  on public.review_invites (created_by);

create index if not exists review_invites_customer_idx
  on public.review_invites (customer_id);
