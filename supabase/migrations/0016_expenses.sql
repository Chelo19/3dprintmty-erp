-- Un gasto es el registro simple de una compra: producto, filamento, servicio u otro.
-- Producto y filamento siguen entrando a existencia por una orden de compra interna.

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  folio text not null,
  kind text not null,
  product_id uuid references public.products (id),
  filament_id uuid references public.filaments (id),
  service_id uuid references public.service_offerings (id),
  description text not null,
  quantity numeric(14, 4) not null,
  amount_minor bigint not null,
  purchase_order_id uuid references public.purchase_orders (id),
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint expenses_kind_check check (kind in ('product', 'filament', 'service', 'other')),
  constraint expenses_quantity_check check (quantity > 0),
  constraint expenses_amount_check check (amount_minor >= 0),
  constraint expenses_target_check check (
    (kind = 'product' and product_id is not null and filament_id is null and service_id is null)
    or (kind = 'filament' and filament_id is not null and product_id is null and service_id is null)
    or (kind = 'service' and service_id is not null and product_id is null and filament_id is null)
    or (kind = 'other' and product_id is null and filament_id is null and service_id is null)
  )
);

create index expenses_tenant_created_idx on public.expenses (tenant_id, created_at desc);
create index expenses_product_idx on public.expenses (product_id);
create index expenses_filament_idx on public.expenses (filament_id);
create index expenses_service_idx on public.expenses (service_id);
create index expenses_purchase_order_idx on public.expenses (purchase_order_id);

select public.apply_tenant_rls('expenses', array['owner', 'admin', 'warehouse'], false);

insert into public.schema_migrations (id) values ('0016_expenses');
