begin;

set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- Os primeiros pedidos presenciais usavam SKUs duplicados que depois foram
-- retirados da vitrine. Consolida somente os vínculos dos cafés de 500 g nos
-- produtos atuais, preservando nome, quantidade e valores históricos do item.
do $$
begin
  if (
    select count(*)
    from (
      values
        ('ITAJAO-500-GRAOS', 'ITAJAO-GRAOS-500'),
        ('ITAJAO-500-MOIDO', 'ITAJAO-MOIDO-500')
    ) as sku_map(legacy_sku, canonical_sku)
    join public.products as legacy on legacy.sku = sku_map.legacy_sku
    join public.products as canonical on canonical.sku = sku_map.canonical_sku
  ) <> 2 then
    raise exception 'Não foi possível localizar todos os SKUs de 500 g para consolidação.';
  end if;
end;
$$;

with sku_map(legacy_sku, canonical_sku) as (
  values
    ('ITAJAO-500-GRAOS', 'ITAJAO-GRAOS-500'),
    ('ITAJAO-500-MOIDO', 'ITAJAO-MOIDO-500')
), product_map as (
  select legacy.id as legacy_id, canonical.id as canonical_id
  from sku_map
  join public.products as legacy on legacy.sku = sku_map.legacy_sku
  join public.products as canonical on canonical.sku = sku_map.canonical_sku
)
update public.order_items as item
   set product_id = product_map.canonical_id
  from product_map
 where item.product_id = product_map.legacy_id;

with sku_map(legacy_sku, canonical_sku) as (
  values
    ('ITAJAO-500-GRAOS', 'ITAJAO-GRAOS-500'),
    ('ITAJAO-500-MOIDO', 'ITAJAO-MOIDO-500')
), product_map as (
  select legacy.id as legacy_id, canonical.id as canonical_id
  from sku_map
  join public.products as legacy on legacy.sku = sku_map.legacy_sku
  join public.products as canonical on canonical.sku = sku_map.canonical_sku
)
update public.product_reviews as review
   set product_id = product_map.canonical_id,
       updated_at = now()
  from product_map
 where review.product_id = product_map.legacy_id;

commit;
