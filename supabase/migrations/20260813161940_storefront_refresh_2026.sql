-- Atualiza a vitrine de 2026 sem apagar produtos ou histórico de cupons.
begin;

-- Os formatos de 250g e o kit genérico de 1kg deixam a vitrine. Os novos
-- formatos de 1kg são separados entre grãos e moído no catálogo público.
update public.products
   set active = false,
       store_visible = false,
       updated_at = now()
 where sku in ('ITAJAO-GRAOS-250', 'ITAJAO-MOIDO-250', 'ITAJAO-KIT-1KG')
    or store_key in ('graos250', 'moido250', 'kit1kg');

-- Fotos reais fornecidas pela Itajaó para os itens já comercializados.
update public.products
   set store_images = case sku
         when 'ITAJAO-GRAOS-500' then '["assets/images/products/real/graos-500-estudio.jpg","assets/images/products/real/graos-500-cafeteria.jpg"]'::jsonb
         when 'ITAJAO-MOIDO-500' then '["assets/images/products/real/moido-500-estudio.jpg"]'::jsonb
         else store_images
       end,
       updated_at = now()
 where sku in ('ITAJAO-GRAOS-500', 'ITAJAO-MOIDO-500');

-- Mantém o cupom anterior somente para auditoria e ativa a nova campanha.
update public.store_coupons
   set active = false,
       updated_at = now()
 where code = 'BEMVINDO10';

insert into public.store_coupons (
  code, name, discount_type, discount_value, minimum_subtotal,
  maximum_discount, first_purchase_only, total_usage_limit,
  per_customer_limit, starts_at, ends_at, active
)
values (
  'BEMVINDO6', '6% na primeira compra', 'percent', 6, 0,
  null, true, null,
  1, null, null, true
)
on conflict (code) do update
   set name = excluded.name,
       discount_type = excluded.discount_type,
       discount_value = excluded.discount_value,
       minimum_subtotal = excluded.minimum_subtotal,
       maximum_discount = excluded.maximum_discount,
       first_purchase_only = excluded.first_purchase_only,
       total_usage_limit = excluded.total_usage_limit,
       per_customer_limit = excluded.per_customer_limit,
       starts_at = excluded.starts_at,
       ends_at = excluded.ends_at,
       active = excluded.active,
       updated_at = now();

commit;
