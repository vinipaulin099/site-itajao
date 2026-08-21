begin;

create or replace function public.crm_admin_delete_reseller_v1(p_reseller_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reseller public.resellers%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Usuário não autenticado.';
  end if;

  if not public.is_admin() then
    raise exception 'Apenas administradores podem excluir revendedores.';
  end if;

  select *
    into v_reseller
    from public.resellers
   where id = p_reseller_id
   for update;

  if v_reseller.id is null then
    raise exception 'Revendedor não encontrado.';
  end if;

  if exists (select 1 from public.orders where reseller_id = p_reseller_id)
     or exists (select 1 from public.customers where reseller_id = p_reseller_id) then
    raise exception 'Este revendedor possui vendas ou clientes vinculados. Marque-o como inativo para preservar o histórico.';
  end if;

  insert into public.inventory_movements
    (product_id, reseller_id, movement_type, quantity, balance_after, notes, created_by)
  select
    stock.product_id,
    p_reseller_id,
    'ajuste',
    abs(stock.quantity),
    0,
    format('Estoque apagado com a exclusão do revendedor %s', v_reseller.name),
    (select auth.uid())
  from public.inventory_stock as stock
  where stock.reseller_id = p_reseller_id
    and stock.quantity <> 0;

  update public.profiles
     set active = false,
         reseller_id = null,
         updated_at = now()
   where reseller_id = p_reseller_id
      or (v_reseller.user_id is not null and user_id = v_reseller.user_id);

  delete from public.inventory_stock where reseller_id = p_reseller_id;
  delete from public.resellers where id = p_reseller_id;
end;
$$;

revoke all on function public.crm_admin_delete_reseller_v1(uuid) from public;
revoke all on function public.crm_admin_delete_reseller_v1(uuid) from anon;
grant execute on function public.crm_admin_delete_reseller_v1(uuid) to authenticated;

comment on function public.crm_admin_delete_reseller_v1(uuid) is
  'Exclui revendedor sem histórico, apaga seu estoque e desativa o acesso associado.';

-- Mantém os registros antigos para preservar pedidos, mas retira duplicidades do catálogo ativo.
update public.products
   set active = false,
       store_visible = false,
       updated_at = now()
 where sku in (
   'ITAJAO-250-GRAOS',
   'ITAJAO-250-MOIDO',
   'ITAJAO-500-GRAOS',
   'ITAJAO-500-MOIDO'
 );

update public.products
   set name = 'ITAJAÓ 500G EM GRÃOS',
       category = 'cafe',
       preparation = 'graos',
       weight_grams = 500,
       sale_price = 59.90,
       active = true,
       store_visible = true,
       store_sort_order = 10,
       updated_at = now()
 where sku = 'ITAJAO-GRAOS-500';

update public.products
   set name = 'ITAJAÓ 500G MOÍDO',
       category = 'cafe',
       preparation = 'moido',
       weight_grams = 500,
       sale_price = 59.90,
       active = true,
       store_visible = true,
       store_sort_order = 20,
       updated_at = now()
 where sku = 'ITAJAO-MOIDO-500';

insert into public.products
  (sku, name, category, preparation, weight_grams, sale_price, active, store_visible, store_sort_order)
values
  ('ITAJAO-1000-GRAOS', 'ITAJAÓ 1KG EM GRÃOS', 'cafe', 'graos', 1000, 119.90, true, false, 100),
  ('ITAJAO-1000-MOIDO', 'ITAJAÓ 1KG MOÍDO', 'cafe', 'moido', 1000, 119.90, true, false, 110),
  ('ITAJAO-3000-GRAOS', 'KIT ITAJAÓ 3KG EM GRÃOS', 'cafe', 'graos', 3000, 319.90, true, false, 120),
  ('ITAJAO-3000-MOIDO', 'KIT ITAJAÓ 3KG MOÍDO', 'cafe', 'moido', 3000, 319.90, true, false, 130),
  ('ITAJAO-5000-GRAOS', 'KIT ITAJAÓ 5KG EM GRÃOS', 'cafe', 'graos', 5000, null, true, false, 140),
  ('ITAJAO-5000-MOIDO', 'KIT ITAJAÓ 5KG MOÍDO', 'cafe', 'moido', 5000, null, true, false, 150),
  ('ITAJAO-10000-GRAOS', 'KIT ITAJAÓ 10KG EM GRÃOS', 'cafe', 'graos', 10000, null, true, false, 160),
  ('ITAJAO-10000-MOIDO', 'KIT ITAJAÓ 10KG MOÍDO', 'cafe', 'moido', 10000, null, true, false, 170)
on conflict (sku) do update
set name = excluded.name,
    category = excluded.category,
    preparation = excluded.preparation,
    weight_grams = excluded.weight_grams,
    sale_price = excluded.sale_price,
    active = excluded.active,
    store_visible = excluded.store_visible,
    store_sort_order = excluded.store_sort_order,
    updated_at = now();

commit;
