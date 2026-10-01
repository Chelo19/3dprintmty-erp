begin;

alter table public.tenant_memberships drop constraint tenant_memberships_role_check;
alter table public.tenant_memberships add constraint tenant_memberships_role_check
  check (role in ('owner', 'admin', 'sales', 'operator', 'production', 'warehouse', 'viewer'));
alter table public.invitations drop constraint invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in ('admin', 'sales', 'operator', 'production', 'warehouse', 'viewer'));

-- Permisos de alta separados de los permisos existentes de edición y eliminación.
do $$
declare target text;
begin
  foreach target in array array['customers', 'customer_addresses', 'quotes', 'quote_lines', 'quote_prints', 'sales_orders', 'sales_order_lines', 'sales_order_prints'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_access_tenant(tenant_id) and public.jwt_role() = %L)', target || '_operator_insert', target, 'operator');
  end loop;
end $$;

create policy payments_operator_insert on public.payments for insert to authenticated
with check (public.can_access_tenant(tenant_id) and public.jwt_role() = 'operator' and kind = 'payment');

create policy payment_settings_operator_select on public.payment_method_settings for select to authenticated
using (public.can_access_tenant(tenant_id) and public.jwt_role() = 'operator');

-- Registrar un cobro actualiza únicamente el estado derivado del libro de pagos.
create policy orders_operator_payment_status on public.sales_orders for update to authenticated
using (public.can_access_tenant(tenant_id) and public.jwt_role() = 'operator')
with check (public.can_access_tenant(tenant_id) and public.jwt_role() = 'operator');

create function public.guard_operator_order_update() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare paid bigint;
begin
  if public.jwt_role() = 'operator' then
    if (to_jsonb(new) - 'payment_status') is distinct from (to_jsonb(old) - 'payment_status') then
      raise exception 'El operador no puede editar pedidos' using errcode = '42501';
    end if;
    select coalesce(sum(case when kind = 'payment' then amount_minor else -amount_minor end), 0)
      into paid from public.payments where sales_order_id = old.id and status = 'completed';
    if new.payment_status <> (case when paid >= old.total_minor then 'paid' when paid > 0 then 'partial' else 'pending' end) then
      raise exception 'El estado de pago debe corresponder al libro de pagos' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_operator_order_update() from public;
create trigger guard_operator_order_update before update on public.sales_orders
for each row execute function public.guard_operator_order_update();

insert into public.schema_migrations (id) values ('0028_operator_role');
commit;
