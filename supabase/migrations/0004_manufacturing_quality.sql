-- Fase 4: estaciones de trabajo, rutas, BOM multinivel, órdenes de producción y calidad.
begin;

create table public.work_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  code text not null,
  name text not null,
  kind text not null default 'printer',
  hourly_rate_minor bigint not null default 0,
  capacity_hours numeric(6, 2) not null default 8,
  active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_centers_code_unique unique (tenant_id, code),
  constraint work_centers_kind_check check (kind in ('printer', 'post_process', 'quality', 'packing', 'other')),
  constraint work_centers_rate_check check (hourly_rate_minor >= 0),
  constraint work_centers_capacity_check check (capacity_hours > 0 and capacity_hours <= 24)
);

create table public.routings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  product_id uuid not null references public.products (id),
  version integer not null,
  active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint routings_version_unique unique (tenant_id, product_id, version)
);

create unique index routings_one_active on public.routings (tenant_id, product_id) where active;

create table public.routing_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  routing_id uuid not null references public.routings (id),
  sequence integer not null,
  code text not null,
  name text not null,
  work_center_id uuid not null references public.work_centers (id),
  setup_minutes numeric(10, 2) not null default 0,
  run_minutes numeric(10, 2) not null default 0,
  constraint routing_operations_sequence_unique unique (routing_id, sequence),
  constraint routing_operations_sequence_check check (sequence > 0),
  constraint routing_operations_minutes_check check (setup_minutes >= 0 and run_minutes >= 0)
);

create index routing_operations_routing_idx on public.routing_operations (tenant_id, routing_id);

create table public.boms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  product_id uuid not null references public.products (id),
  version integer not null,
  active boolean not null default true,
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint boms_version_unique unique (tenant_id, product_id, version)
);

create unique index boms_one_active on public.boms (tenant_id, product_id) where active;

create table public.bom_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  bom_id uuid not null references public.boms (id),
  component_product_id uuid not null references public.products (id),
  quantity numeric(14, 4) not null,
  scrap_pct numeric(6, 2) not null default 0,
  sequence integer not null default 1,
  constraint bom_lines_quantity_check check (quantity > 0),
  constraint bom_lines_scrap_check check (scrap_pct >= 0 and scrap_pct <= 100)
);

create index bom_lines_bom_idx on public.bom_lines (tenant_id, bom_id);

create table public.production_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  folio text not null,
  product_id uuid not null references public.products (id),
  location_id uuid not null references public.locations (id),
  sales_order_id uuid references public.sales_orders (id),
  planned_order_id uuid,
  source text not null default 'manual',
  kind text not null default 'make_to_stock',
  status text not null default 'draft',
  priority smallint not null default 3,
  quantity_ordered numeric(14, 4) not null,
  quantity_completed numeric(14, 4) not null default 0,
  quantity_scrapped numeric(14, 4) not null default 0,
  due_date date,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  bom_id uuid references public.boms (id),
  routing_id uuid references public.routings (id),
  estimated_cost_minor bigint,
  actual_cost_minor bigint,
  qc_status text not null default 'not_required',
  scrap_reason text,
  short_reason text,
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_orders_folio_unique unique (tenant_id, folio),
  constraint production_orders_source_check check (source in ('manual', 'sales_order', 'mrp_planned')),
  constraint production_orders_kind_check check (kind in ('make_to_order', 'make_to_stock')),
  constraint production_orders_status_check check (
    status in (
      'draft', 'released', 'scheduled', 'in_progress', 'qc_hold',
      'completed', 'closed', 'on_hold', 'cancelled'
    )
  ),
  constraint production_orders_priority_check check (priority between 1 and 5),
  constraint production_orders_qty_check check (
    quantity_ordered > 0 and quantity_completed >= 0 and quantity_scrapped >= 0
  ),
  constraint production_orders_qc_check check (
    qc_status in ('not_required', 'pending', 'passed', 'failed', 'waived')
  )
);

create index production_orders_tenant_status_idx on public.production_orders (tenant_id, status);
create index production_orders_sales_order_idx on public.production_orders (tenant_id, sales_order_id);

create table public.production_order_materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  production_order_id uuid not null references public.production_orders (id),
  component_product_id uuid not null references public.products (id),
  required_qty numeric(14, 4) not null,
  allocated_qty numeric(14, 4) not null default 0,
  consumed_qty numeric(14, 4) not null default 0,
  unit_cost_minor numeric(18, 6) not null default 0,
  created_at timestamptz not null default now(),
  constraint production_order_materials_qty_check check (
    required_qty >= 0 and allocated_qty >= 0 and consumed_qty >= 0
  )
);

create index production_order_materials_order_idx on public.production_order_materials (tenant_id, production_order_id);

create table public.production_order_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  production_order_id uuid not null references public.production_orders (id),
  sequence integer not null,
  code text not null,
  name text not null,
  work_center_id uuid not null references public.work_centers (id),
  planned_minutes numeric(10, 2) not null default 0,
  hourly_rate_minor bigint not null default 0,
  status text not null default 'pending',
  actual_minutes numeric(10, 2),
  started_at timestamptz,
  completed_at timestamptz,
  constraint production_order_operations_status_check check (
    status in ('pending', 'running', 'complete', 'skipped')
  )
);

create index production_order_operations_order_idx on public.production_order_operations (tenant_id, production_order_id);

create table public.production_consumptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  production_order_id uuid not null references public.production_orders (id),
  material_id uuid not null references public.production_order_materials (id),
  product_id uuid not null references public.products (id),
  spool_id uuid references public.spools (id),
  lot_id uuid references public.material_lots (id),
  quantity numeric(14, 4) not null,
  value_minor bigint not null default 0,
  source text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint production_consumptions_qty_check check (quantity > 0),
  constraint production_consumptions_source_check check (source in ('spool', 'backflush'))
);

create index production_consumptions_order_idx on public.production_consumptions (tenant_id, production_order_id);
create index production_consumptions_spool_idx on public.production_consumptions (tenant_id, spool_id);

alter table public.spool_events
  add constraint spool_events_production_order_fk
  foreign key (production_order_id) references public.production_orders (id);

create table public.defect_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  code text not null,
  name text not null,
  active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint defect_types_code_unique unique (tenant_id, code)
);

create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  production_order_id uuid not null references public.production_orders (id),
  result text not null,
  qty_passed numeric(14, 4) not null,
  qty_failed numeric(14, 4) not null default 0,
  defect_type_id uuid references public.defect_types (id),
  disposition text,
  notes text,
  photo_path text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint inspections_result_check check (result in ('pass', 'fail')),
  constraint inspections_disposition_check check (disposition is null or disposition in ('rework', 'scrap')),
  constraint inspections_qty_check check (qty_passed >= 0 and qty_failed >= 0)
);

create index inspections_order_idx on public.inspections (tenant_id, production_order_id);

create trigger work_centers_updated_at
before update on public.work_centers
for each row execute function public.set_updated_at();

create trigger production_orders_updated_at
before update on public.production_orders
for each row execute function public.set_updated_at();

select public.apply_tenant_rls('work_centers', array['owner', 'admin', 'production']);
select public.apply_tenant_rls('routings', array['owner', 'admin', 'production']);
select public.apply_tenant_rls('routing_operations', array['owner', 'admin', 'production']);
select public.apply_tenant_rls('boms', array['owner', 'admin', 'production']);
select public.apply_tenant_rls('bom_lines', array['owner', 'admin', 'production']);
select public.apply_tenant_rls('production_orders', array['owner', 'admin', 'production']);
select public.apply_tenant_rls('production_order_materials', array['owner', 'admin', 'production']);
select public.apply_tenant_rls('production_order_operations', array['owner', 'admin', 'production']);
select public.apply_tenant_rls('production_consumptions', array['owner', 'admin', 'production']);
select public.apply_tenant_rls('defect_types', array['owner', 'admin', 'production']);
select public.apply_tenant_rls('inspections', array['owner', 'admin', 'production']);

insert into public.schema_migrations (id) values ('0004_manufacturing_quality');

commit;
