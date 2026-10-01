begin;

-- Prefacturas: consulta y alta, sin permisos de cancelación o edición.
do $$
declare target text;
begin
  foreach target in array array['commercial_documents', 'commercial_document_lines'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.can_access_tenant(tenant_id) and public.jwt_role() = %L)', target || '_operator_select', target, 'operator');
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_access_tenant(tenant_id) and public.jwt_role() = %L)', target || '_operator_insert', target, 'operator');
  end loop;
  foreach target in array array['stock_balances', 'spools', 'production_orders', 'production_order_materials', 'production_order_operations', 'inspections'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_access_tenant(tenant_id) and public.jwt_role() = %L)', target || '_operator_insert', target, 'operator');
    execute format('create policy %I on public.%I for update to authenticated using (public.can_access_tenant(tenant_id) and public.jwt_role() = %L) with check (public.can_access_tenant(tenant_id) and public.jwt_role() = %L)', target || '_operator_update', target, 'operator', 'operator');
  end loop;
  foreach target in array array['stock_ledgers', 'spool_events', 'production_consumptions'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_access_tenant(tenant_id) and public.jwt_role() = %L)', target || '_operator_insert', target, 'operator');
  end loop;
end $$;

-- Fabricar puede apartar producto para un pedido; no puede cambiar sus partidas.
create policy sales_order_lines_operator_reserve on public.sales_order_lines for update to authenticated
using (public.can_access_tenant(tenant_id) and public.jwt_role() = 'operator')
with check (public.can_access_tenant(tenant_id) and public.jwt_role() = 'operator');
create function public.guard_operator_line_update() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if public.jwt_role() = 'operator' and ((to_jsonb(new) - 'reserved_qty') is distinct from (to_jsonb(old) - 'reserved_qty') or new.reserved_qty < 0 or new.reserved_qty > new.quantity - new.closed_short_qty - new.shipped_qty) then
    raise exception 'El operador solo puede apartar existencias' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_operator_line_update() from public;
create trigger guard_operator_line_update before update on public.sales_order_lines
for each row execute function public.guard_operator_line_update();

-- Solo permite estados derivados del libro de pagos y de los apartados/OP.
create or replace function public.guard_operator_order_update() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare paid bigint; derived_status text; derived_fulfillment text;
begin
  if public.jwt_role() = 'operator' then
    if (to_jsonb(new) - array['payment_status', 'status', 'fulfillment_status', 'updated_at']) is distinct from (to_jsonb(old) - array['payment_status', 'status', 'fulfillment_status', 'updated_at']) then
      raise exception 'El operador no puede editar pedidos' using errcode = '42501';
    end if;
    select coalesce(sum(case when kind = 'payment' then amount_minor else -amount_minor end), 0)
      into paid from public.payments where sales_order_id = old.id and status = 'completed';
    if new.payment_status <> (case when paid >= old.total_minor then 'paid' when paid > 0 then 'partial' else 'pending' end) then
      raise exception 'El estado de pago debe corresponder al libro de pagos' using errcode = '42501';
    end if;
    if new.status is distinct from old.status or new.fulfillment_status is distinct from old.fulfillment_status then
      if old.status not in ('confirmed', 'in_production', 'ready_to_ship') then
        raise exception 'El operador no puede confirmar ni cancelar pedidos' using errcode = '42501';
      end if;
      derived_status := 'confirmed';
      if not exists (select 1 from public.sales_order_lines where sales_order_id = old.id and line_kind = 'product' and product_id is not null and quantity - closed_short_qty > reserved_qty + shipped_qty) then
        derived_status := 'ready_to_ship';
      elsif exists (select 1 from public.production_orders where sales_order_id = old.id and status in ('draft', 'released', 'scheduled', 'in_progress', 'qc_hold')) then
        derived_status := 'in_production';
      end if;
      derived_fulfillment := old.fulfillment_status;
      if derived_status = 'ready_to_ship' and derived_fulfillment = 'pending' then derived_fulfillment := 'ready'; end if;
      if derived_status <> 'ready_to_ship' and derived_fulfillment in ('ready', 'picking', 'packing') then derived_fulfillment := 'pending'; end if;
      if new.status <> derived_status or new.fulfillment_status <> derived_fulfillment then
        raise exception 'El estado del pedido debe corresponder a sus apartados y producción' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

insert into public.schema_migrations (id) values ('0029_operator_workshop_access');
commit;
