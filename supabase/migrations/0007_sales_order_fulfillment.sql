begin;

alter table public.sales_orders
  add column location_id uuid references public.locations (id),
  add column promised_date date,
  add column ship_to jsonb,
  add column carrier text,
  add column tracking_number text,
  add column shipment_folio text,
  add column shipped_at timestamptz,
  add column delivered_at timestamptz,
  add column hold_reason text,
  add column cancel_reason text,
  add column closed_short_reason text,
  add column notes text;

create index sales_orders_location_idx on public.sales_orders (tenant_id, location_id);

alter table public.sales_order_lines
  add column position integer not null default 0,
  add column reserved_qty numeric(14, 4) not null default 0,
  add column shipped_qty numeric(14, 4) not null default 0,
  add column closed_short_qty numeric(14, 4) not null default 0;

create table public.sales_order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  sales_order_id uuid not null references public.sales_orders (id),
  kind text not null,
  from_status text,
  to_status text,
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create index sales_order_events_order_idx on public.sales_order_events (tenant_id, sales_order_id, created_at desc);

alter table public.sales_order_events enable row level security;
alter table public.sales_order_events force row level security;

create policy sales_order_events_select on public.sales_order_events
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy sales_order_events_insert on public.sales_order_events
for insert to authenticated
with check (public.can_access_tenant(tenant_id));

grant select, insert on public.sales_order_events to authenticated;

grant update, delete on public.sales_order_lines to authenticated;

create policy sales_order_lines_update on public.sales_order_lines
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales', 'warehouse', 'production')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales', 'warehouse', 'production')
);

create policy sales_order_lines_delete on public.sales_order_lines
for delete to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

-- Confirmar un pedido aparta material. Ventas escribe el apartado; el API sigue
-- reservando entradas y salidas físicas a almacén.
drop policy stock_balances_write on public.stock_balances;
drop policy stock_balances_update on public.stock_balances;
drop policy stock_ledgers_insert on public.stock_ledgers;

create policy stock_balances_write on public.stock_balances
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales', 'warehouse', 'production')
);

create policy stock_balances_update on public.stock_balances
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales', 'warehouse', 'production')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales', 'warehouse', 'production')
);

create policy stock_ledgers_insert on public.stock_ledgers
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales', 'warehouse', 'production')
);

drop policy sales_orders_update on public.sales_orders;

create policy sales_orders_update on public.sales_orders
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales', 'warehouse', 'production')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales', 'warehouse', 'production')
);

insert into public.schema_migrations (id) values ('0007_sales_order_fulfillment');

commit;
