-- Fase 5: proveedores, órdenes de compra, recepción con lotes y MRP.
begin;

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  rfc text,
  email text,
  phone text,
  payment_terms text not null default 'contado',
  lead_time_days integer not null default 0,
  notes text,
  active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendors_lead_time_check check (lead_time_days >= 0 and lead_time_days <= 365)
);

create index vendors_tenant_idx on public.vendors (tenant_id, active);
create unique index vendors_rfc_unique on public.vendors (tenant_id, rfc) where rfc is not null;

create table public.mrp_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  horizon_days integer not null,
  stats jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint mrp_runs_horizon_check check (horizon_days between 1 and 365)
);

create index mrp_runs_tenant_idx on public.mrp_runs (tenant_id, created_at desc);

create table public.mrp_planned_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  run_id uuid not null references public.mrp_runs (id),
  product_id uuid not null references public.products (id),
  kind text not null,
  quantity numeric(14, 4) not null,
  need_by date,
  release_by date,
  status text not null default 'planned',
  sources jsonb not null default '[]'::jsonb,
  released_type text,
  released_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mrp_planned_orders_kind_check check (kind in ('buy', 'make')),
  constraint mrp_planned_orders_qty_check check (quantity > 0),
  constraint mrp_planned_orders_status_check check (status in ('planned', 'firmed', 'released', 'cancelled')),
  constraint mrp_planned_orders_released_check check (released_type is null or released_type in ('purchase_order', 'production_order'))
);

create index mrp_planned_orders_tenant_status_idx on public.mrp_planned_orders (tenant_id, status);

alter table public.production_orders
  add constraint production_orders_planned_order_fk
  foreign key (planned_order_id) references public.mrp_planned_orders (id);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  folio text not null,
  vendor_id uuid not null references public.vendors (id),
  vendor_name text not null,
  location_id uuid not null references public.locations (id),
  status text not null default 'draft',
  expected_date date,
  ordered_at timestamptz,
  received_at timestamptz,
  closed_at timestamptz,
  currency text not null default 'MXN',
  subtotal_minor bigint not null default 0,
  vat_minor bigint not null default 0,
  total_minor bigint not null default 0,
  planned_order_id uuid references public.mrp_planned_orders (id),
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_orders_folio_unique unique (tenant_id, folio),
  constraint purchase_orders_status_check check (
    status in ('draft', 'ordered', 'partially_received', 'received', 'closed', 'cancelled')
  )
);

create index purchase_orders_tenant_status_idx on public.purchase_orders (tenant_id, status);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  purchase_order_id uuid not null references public.purchase_orders (id),
  product_id uuid not null references public.products (id),
  description text not null,
  purchase_uom text not null,
  uom_factor numeric(12, 4) not null,
  quantity numeric(14, 4) not null,
  received_qty numeric(14, 4) not null default 0,
  unit_cost_minor bigint not null,
  line_total_minor bigint not null,
  created_at timestamptz not null default now(),
  constraint purchase_order_lines_qty_check check (quantity > 0 and received_qty >= 0),
  constraint purchase_order_lines_cost_check check (unit_cost_minor >= 0)
);

create index purchase_order_lines_order_idx on public.purchase_order_lines (tenant_id, purchase_order_id);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  folio text not null,
  purchase_order_id uuid not null references public.purchase_orders (id),
  location_id uuid not null references public.locations (id),
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint receipts_folio_unique unique (tenant_id, folio)
);

create table public.receipt_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  receipt_id uuid not null references public.receipts (id),
  purchase_order_line_id uuid not null references public.purchase_order_lines (id),
  product_id uuid not null references public.products (id),
  quantity numeric(14, 4) not null,
  stock_quantity numeric(14, 4) not null,
  lot_id uuid references public.material_lots (id),
  value_minor bigint not null default 0,
  constraint receipt_lines_qty_check check (quantity > 0 and stock_quantity > 0)
);

create index receipt_lines_receipt_idx on public.receipt_lines (tenant_id, receipt_id);

alter table public.material_lots add column vendor_id uuid references public.vendors (id);
alter table public.material_lots add column purchase_order_id uuid references public.purchase_orders (id);
alter table public.material_lots add column receipt_id uuid references public.receipts (id);

create trigger vendors_updated_at
before update on public.vendors
for each row execute function public.set_updated_at();

create trigger purchase_orders_updated_at
before update on public.purchase_orders
for each row execute function public.set_updated_at();

create trigger mrp_planned_orders_updated_at
before update on public.mrp_planned_orders
for each row execute function public.set_updated_at();

select public.apply_tenant_rls('vendors', array['owner', 'admin', 'warehouse']);
select public.apply_tenant_rls('purchase_orders', array['owner', 'admin', 'warehouse']);
select public.apply_tenant_rls('purchase_order_lines', array['owner', 'admin', 'warehouse']);
select public.apply_tenant_rls('receipts', array['owner', 'admin', 'warehouse']);
select public.apply_tenant_rls('receipt_lines', array['owner', 'admin', 'warehouse']);
select public.apply_tenant_rls('mrp_runs', array['owner', 'admin', 'production', 'warehouse']);
select public.apply_tenant_rls('mrp_planned_orders', array['owner', 'admin', 'production', 'warehouse'], true);

insert into public.schema_migrations (id) values ('0005_purchasing_mrp');

commit;
