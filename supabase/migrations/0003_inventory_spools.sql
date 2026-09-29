-- Fase 1 completa: lotes, rollos, conteo cíclico y kardex valuado.
begin;

-- RLS de tabla de negocio: lectura por membresía (o por roles si se indican) y escritura por rol.
-- Solo la usa el dueño de las migraciones.
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
    'create policy %I on public.%I for select to authenticated using (public.can_access_tenant(tenant_id)%s)',
    target || '_select', target, reader_check
  );
  execute format(
    'create policy %I on public.%I for insert to authenticated with check (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s))',
    target || '_insert', target, writer_list
  );
  execute format(
    'create policy %I on public.%I for update to authenticated using (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s)) with check (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s))',
    target || '_update', target, writer_list, writer_list
  );
  execute format('grant select, insert, update on public.%I to authenticated', target);
  if allow_delete then
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s))',
      target || '_delete', target, writer_list
    );
    execute format('grant delete on public.%I to authenticated', target);
  end if;
end;
$$;

revoke all on function public.apply_tenant_rls(text, text[], boolean, text[]) from public;

alter table public.products add column qc_rigor text not null default 'off';
alter table public.products
  add constraint products_qc_rigor_check check (qc_rigor in ('off', 'basic', 'full'));

create or replace view public.products_visible
with (security_barrier = true) as
select
  p.id,
  p.tenant_id,
  p.sku,
  p.name,
  p.product_type,
  p.status,
  p.material,
  p.color,
  p.diameter_mm,
  p.stock_uom,
  p.purchase_uom,
  p.uom_factor,
  p.cost_minor,
  case
    when public.jwt_role() = 'production' then null
    else p.sale_price_minor
  end as sale_price_minor,
  p.created_by,
  p.created_at,
  p.updated_at,
  p.qc_rigor
from public.products p
where public.can_access_tenant(p.tenant_id);

alter table public.company_profiles add column qc_gate text not null default 'warn';
alter table public.company_profiles
  add constraint company_profiles_qc_gate_check check (qc_gate in ('off', 'warn', 'block'));

-- Producción aparta y consume material, así que también mueve existencias.
drop policy stock_balances_write on public.stock_balances;
drop policy stock_balances_update on public.stock_balances;
drop policy stock_ledgers_insert on public.stock_ledgers;

create policy stock_balances_write on public.stock_balances
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse', 'production')
);

create policy stock_balances_update on public.stock_balances
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse', 'production')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse', 'production')
);

create policy stock_ledgers_insert on public.stock_ledgers
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse', 'production')
);

create table public.material_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  product_id uuid not null references public.products (id),
  lot_number text not null,
  vendor_lot text,
  source text not null default 'manual',
  received_qty numeric(14, 4) not null default 0,
  received_at timestamptz not null default now(),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint material_lots_number_unique unique (tenant_id, lot_number),
  constraint material_lots_source_check check (source in ('manual', 'purchase')),
  constraint material_lots_qty_check check (received_qty >= 0)
);

create index material_lots_product_idx on public.material_lots (tenant_id, product_id);

alter table public.stock_ledgers add column value_minor bigint;
alter table public.stock_ledgers add column reference_type text;
alter table public.stock_ledgers add column reference_id uuid;
alter table public.stock_ledgers add column lot_id uuid references public.material_lots (id);

create table public.spools (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  spool_number text not null,
  product_id uuid not null references public.products (id),
  location_id uuid not null references public.locations (id),
  lot_id uuid references public.material_lots (id),
  initial_grams numeric(14, 4) not null,
  current_grams numeric(14, 4) not null,
  status text not null default 'available',
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spools_number_unique unique (tenant_id, spool_number),
  constraint spools_initial_check check (initial_grams > 0),
  constraint spools_current_check check (current_grams >= 0),
  constraint spools_status_check check (status in ('available', 'in_use', 'empty', 'scrapped'))
);

create index spools_tenant_product_idx on public.spools (tenant_id, product_id, status);

create table public.spool_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  spool_id uuid not null references public.spools (id),
  kind text not null,
  grams numeric(14, 4) not null,
  reason text not null,
  production_order_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint spool_events_kind_check check (kind in ('receipt', 'consume', 'adjust', 'scrap'))
);

create index spool_events_spool_idx on public.spool_events (tenant_id, spool_id, created_at desc);

create table public.cycle_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  folio text not null,
  location_id uuid not null references public.locations (id),
  reference text not null,
  adjustments integer not null default 0,
  variance_value_minor bigint not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint cycle_counts_folio_unique unique (tenant_id, folio)
);

create table public.cycle_count_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  cycle_count_id uuid not null references public.cycle_counts (id),
  product_id uuid not null references public.products (id),
  system_qty numeric(14, 4) not null,
  counted_qty numeric(14, 4) not null,
  variance numeric(14, 4) not null,
  reason text not null,
  value_minor bigint not null default 0,
  constraint cycle_count_lines_counted_check check (counted_qty >= 0)
);

create index cycle_count_lines_count_idx on public.cycle_count_lines (tenant_id, cycle_count_id);

create trigger spools_updated_at
before update on public.spools
for each row execute function public.set_updated_at();

select public.apply_tenant_rls('material_lots', array['owner', 'admin', 'warehouse']);
select public.apply_tenant_rls('spools', array['owner', 'admin', 'warehouse', 'production']);
select public.apply_tenant_rls('spool_events', array['owner', 'admin', 'warehouse', 'production']);
select public.apply_tenant_rls('cycle_counts', array['owner', 'admin', 'warehouse']);
select public.apply_tenant_rls('cycle_count_lines', array['owner', 'admin', 'warehouse']);

insert into public.schema_migrations (id) values ('0003_inventory_spools');

commit;
