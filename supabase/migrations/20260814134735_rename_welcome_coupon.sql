begin;

do $$
begin
  if exists (
    select 1
      from public.store_coupons
     where code = 'BEMVINDO'
  ) then
    update public.store_coupons
       set name = '6% na primeira compra',
           discount_type = 'percent',
           discount_value = 6,
           minimum_subtotal = 0,
           maximum_discount = null,
           first_purchase_only = true,
           total_usage_limit = null,
           per_customer_limit = 1,
           starts_at = null,
           ends_at = null,
           active = true,
           updated_at = now()
     where code = 'BEMVINDO';

    update public.store_coupons
       set active = false,
           updated_at = now()
     where code = 'BEMVINDO6';
  else
    update public.store_coupons
       set code = 'BEMVINDO',
           name = '6% na primeira compra',
           active = true,
           updated_at = now()
     where code = 'BEMVINDO6';

    if not found then
      insert into public.store_coupons (
        code, name, discount_type, discount_value, minimum_subtotal,
        maximum_discount, first_purchase_only, total_usage_limit,
        per_customer_limit, starts_at, ends_at, active
      )
      values (
        'BEMVINDO', '6% na primeira compra', 'percent', 6, 0,
        null, true, null,
        1, null, null, true
      );
    end if;
  end if;
end
$$;

commit;
