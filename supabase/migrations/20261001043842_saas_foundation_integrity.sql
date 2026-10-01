-- La API Nest es la superficie de negocio; Supabase Auth conserva authenticated.
-- Aplicar antes de desplegar la API que usa erp_api. No borra ni corrige datos.
begin;
set local lock_timeout = '10s';

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'erp_api') then
    create role erp_api nologin nosuperuser nobypassrls;
  elsif exists (select 1 from pg_roles where rolname='erp_api' and (rolcanlogin or rolsuper or rolbypassrls)) then
    raise exception 'erp_api debe ser un rol interno sin LOGIN, SUPERUSER ni BYPASSRLS';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  execute format('grant erp_api to %I', current_user);
end $$;
grant usage on schema public to erp_api;

-- Reemplaza acceso authenticated por acceso exclusivo de la API, conservando
-- los privilegios existentes de cada tabla y sus predicados RLS por rol.
do $$
declare item record; permission text;
begin
  for item in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname = any(array['user_accounts', 'platform_admins', 'tenants', 'tenant_memberships', 'platform_audit_log', 'company_profiles', 'locations', 'tax_rates', 'payment_method_settings', 'number_sequences', 'products', 'filaments', 'audit_events', 'invitations', 'stock_balances', 'stock_ledgers', 'customers', 'customer_addresses', 'service_offerings', 'quotes', 'quote_prints', 'quote_lines', 'sales_orders', 'sales_order_prints', 'sales_order_lines', 'sales_order_events', 'payments', 'idempotency_keys', 'spools', 'spool_events', 'material_lots', 'work_centers', 'routings', 'routing_operations', 'boms', 'bom_lines', 'production_orders', 'production_order_materials', 'production_order_operations', 'production_consumptions', 'defect_types', 'inspections', 'vendors', 'purchase_orders', 'purchase_order_lines', 'receipts', 'receipt_lines', 'expenses', 'expense_payments', 'commercial_documents', 'commercial_document_lines', 'products_visible'])
  loop
    foreach permission in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if has_table_privilege('authenticated', item.oid, permission) then
        execute format('grant %s on public.%I to erp_api', permission, item.relname);
      end if;
    end loop;
    execute format('revoke all on public.%I from authenticated, anon, public', item.relname);
  end loop;
  for item in select p.polname, c.relname from pg_policy p join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname = any(array['user_accounts', 'platform_admins', 'tenants', 'tenant_memberships', 'platform_audit_log', 'company_profiles', 'locations', 'tax_rates', 'payment_method_settings', 'number_sequences', 'products', 'filaments', 'audit_events', 'invitations', 'stock_balances', 'stock_ledgers', 'customers', 'customer_addresses', 'service_offerings', 'quotes', 'quote_prints', 'quote_lines', 'sales_orders', 'sales_order_prints', 'sales_order_lines', 'sales_order_events', 'payments', 'idempotency_keys', 'spools', 'spool_events', 'material_lots', 'work_centers', 'routings', 'routing_operations', 'boms', 'bom_lines', 'production_orders', 'production_order_materials', 'production_order_operations', 'production_consumptions', 'defect_types', 'inspections', 'vendors', 'purchase_orders', 'purchase_order_lines', 'receipts', 'receipt_lines', 'expenses', 'expense_payments', 'commercial_documents', 'commercial_document_lines', 'products_visible'])
      and p.polroles = array[(select oid from pg_roles where rolname='authenticated')]
  loop
    execute format('alter policy %I on public.%I to erp_api', item.polname, item.relname);
  end loop;
end $$;

alter default privileges in schema public revoke all on tables from authenticated, anon, public;

-- Las futuras tablas creadas con este helper heredan la misma superficie privada.
create or replace function public.apply_tenant_rls(
  target text,
  writers text[],
  allow_delete boolean default false,
  readers text[] default null
)
returns void
language plpgsql
as $$
declare
  writer_list text := array_to_string(array(select quote_literal(r) from unnest(writers) as r), ', ');
  reader_check text := '';
begin
  if readers is not null then
    reader_check := format(
      ' and public.jwt_role() in (%s)',
      array_to_string(array(select quote_literal(r) from unnest(readers) as r), ', ')
    );
  end if;
  execute format('alter table public.%I enable row level security', target);
  execute format('alter table public.%I force row level security', target);
  execute format(
    'create policy %I on public.%I for select to erp_api using (public.can_access_tenant(tenant_id)%s)',
    target || '_select', target, reader_check
  );
  execute format(
    'create policy %I on public.%I for insert to erp_api with check (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s))',
    target || '_insert', target, writer_list
  );
  execute format(
    'create policy %I on public.%I for update to erp_api using (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s)) with check (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s))',
    target || '_update', target, writer_list, writer_list
  );
  execute format('grant select, insert, update on public.%I to erp_api', target);
  if allow_delete then
    execute format(
      'create policy %I on public.%I for delete to erp_api using (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s))',
      target || '_delete', target, writer_list
    );
    execute format('grant delete on public.%I to erp_api', target);
  end if;
end;
$$;

revoke all on function public.apply_tenant_rls(text, text[], boolean, text[]) from public, authenticated, anon;

-- Toda FK entre entidades con tenant_id también debe verificar ese tenant.
-- Se conservan las FK originales y las acciones de borrado. Validar los datos
-- existentes es obligatorio: una relación cruzada aborta toda la migración.
do $$
declare link record; delete_action text;
begin
  for link in
    select child.relname as child_table, parent.relname as parent_table, a.attname as child_column,
      k.conname, k.confdeltype
    from pg_constraint k
    join pg_class child on child.oid=k.conrelid
    join pg_class parent on parent.oid=k.confrelid
    join pg_namespace n on n.oid=child.relnamespace
    join pg_attribute a on a.attrelid=child.oid and a.attnum=k.conkey[1]
    join pg_attribute b on b.attrelid=parent.oid and b.attnum=k.confkey[1]
    where k.contype='f' and n.nspname='public' and array_length(k.conkey,1)=1
      and a.attname <> 'tenant_id' and b.attname='id'
      and exists (select 1 from pg_attribute where attrelid=child.oid and attname='tenant_id' and not attisdropped)
      and exists (select 1 from pg_attribute where attrelid=parent.oid and attname='tenant_id' and not attisdropped)
    order by child.relname, a.attname
  loop
    execute format('create unique index if not exists %I on public.%I (tenant_id,id)',
      'erp_'||link.parent_table||'_tenant_id_key', link.parent_table);
    execute format('create index if not exists %I on public.%I (tenant_id,%I)',
      'erp_'||link.child_table||'_'||link.child_column||'_idx',link.child_table,link.child_column);
    delete_action := case link.confdeltype
      when 'c' then 'cascade' when 'r' then 'restrict'
      when 'n' then format('set null (%I)',link.child_column)
      else 'no action' end;
    execute format('alter table public.%I add constraint %I foreign key (tenant_id,%I) references public.%I (tenant_id,id) on delete %s',
      link.child_table, 'erp_'||link.child_table||'_'||link.child_column||'_fk', link.child_column, link.parent_table, delete_action);
  end loop;
end $$;

-- No se reutilizan las llaves heredadas sin tenant/operación. Se preserva su historial.
create table public.idempotency_requests (
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references public.user_accounts(id),
  operation text not null,
  key text not null check (length(key) between 1 and 80),
  request_hash text not null,
  status text not null default 'processing' check (status in ('processing','completed')),
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (tenant_id,user_id,operation,key),
  check (status <> 'completed' or (response is not null and completed_at is not null))
);
alter table public.idempotency_requests enable row level security;
alter table public.idempotency_requests force row level security;
revoke all on public.idempotency_requests from authenticated, anon, public, erp_api;

insert into public.schema_migrations(id) values ('20261001043842_saas_foundation_integrity');
commit;
