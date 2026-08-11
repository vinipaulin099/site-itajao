begin;

alter view public.admin_financial_order_summary set (security_invoker = true);
alter view public.admin_product_pricing set (security_invoker = true);

revoke all on public.admin_financial_order_summary from public, anon;
revoke all on public.admin_product_pricing from public, anon;
grant select on public.admin_financial_order_summary to authenticated, service_role;
grant select on public.admin_product_pricing to authenticated, service_role;
grant select on public.products to authenticated;
grant select on public.order_items to authenticated;

revoke all on function public.crm_adjust_stock(uuid, integer, uuid, text) from public, anon;
revoke all on function public.crm_admin_delete_customer_v2(uuid) from public, anon;
revoke all on function public.crm_admin_delete_order_v2(uuid) from public, anon;
revoke all on function public.crm_cancel_order(uuid) from public, anon;
revoke all on function public.crm_create_order(jsonb) from public, anon;
revoke all on function public.crm_create_order_with_notifications(jsonb) from public, anon;
revoke all on function public.crm_mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.crm_transfer_stock(uuid, uuid, integer, text) from public, anon;
revoke all on function public.crm_update_product_pricing(uuid, numeric, numeric) from public, anon;
revoke all on function public.current_reseller_id() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.handle_crm_auth_user() from public, anon, authenticated;

grant execute on function public.crm_adjust_stock(uuid, integer, uuid, text) to authenticated, service_role;
grant execute on function public.crm_admin_delete_customer_v2(uuid) to authenticated, service_role;
grant execute on function public.crm_admin_delete_order_v2(uuid) to authenticated, service_role;
grant execute on function public.crm_cancel_order(uuid) to authenticated, service_role;
grant execute on function public.crm_create_order(jsonb) to authenticated, service_role;
grant execute on function public.crm_create_order_with_notifications(jsonb) to authenticated, service_role;
grant execute on function public.crm_mark_notifications_read(uuid[]) to authenticated, service_role;
grant execute on function public.crm_transfer_stock(uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function public.crm_update_product_pricing(uuid, numeric, numeric) to authenticated, service_role;
grant execute on function public.current_reseller_id() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.handle_crm_auth_user() to service_role;

commit;
