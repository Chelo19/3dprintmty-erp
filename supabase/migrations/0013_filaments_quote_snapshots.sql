-- Filamentos en su propia tabla. La cotización guarda una copia y no depende del catálogo.
begin;

create table public.filaments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  sku text not null,
  name text not null,
  material text not null,
  color text not null,
  diameter_mm numeric(4, 2) not null,
  cost_minor bigint,
  sale_price_minor bigint,
  status text not null default 'active',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint filaments_sku_unique unique (tenant_id, sku),
  constraint filaments_diameter_check check (diameter_mm in (1.75, 2.85)),
  constraint filaments_status_check check (status in ('active', 'inactive')),
  constraint filaments_cost_check check (cost_minor is null or cost_minor >= 0),
  constraint filaments_price_check check (sale_price_minor is null or sale_price_minor >= 0)
);

create index filaments_tenant_status_idx on public.filaments (tenant_id, status);

create trigger filaments_updated_at
before update on public.filaments
for each row execute function public.set_updated_at();

insert into public.filaments (
  id, tenant_id, sku, name, material, color, diameter_mm, cost_minor, sale_price_minor, status, created_by, created_at, updated_at
)
select
  id,
  tenant_id,
  sku,
  name,
  coalesce(nullif(btrim(material), ''), 'PLA'),
  coalesce(nullif(btrim(color), ''), 'Sin color'),
  case when diameter_mm in (1.75, 2.85) then diameter_mm else 1.75 end,
  cost_minor,
  sale_price_minor,
  case when status = 'inactive' then 'inactive' else 'active' end,
  created_by,
  created_at,
  updated_at
from public.products
where product_type = 'raw_material';

select public.apply_tenant_rls('filaments', array['owner', 'admin', 'warehouse']);

-- Existencias: un renglón es producto o filamento.
alter table public.stock_balances add column filament_id uuid references public.filaments (id);
alter table public.stock_balances alter column product_id drop not null;
update public.stock_balances
set filament_id = product_id, product_id = null
where product_id in (select id from public.filaments);
alter table public.stock_balances drop constraint stock_balances_unique;
alter table public.stock_balances
  add constraint stock_balances_item_check check ((product_id is not null) <> (filament_id is not null));
create unique index stock_balances_product_location_uidx
  on public.stock_balances (tenant_id, product_id, location_id)
  where product_id is not null;
create unique index stock_balances_filament_location_uidx
  on public.stock_balances (tenant_id, filament_id, location_id)
  where filament_id is not null;
create index stock_balances_filament_idx on public.stock_balances (tenant_id, filament_id);

alter table public.stock_ledgers add column filament_id uuid references public.filaments (id);
alter table public.stock_ledgers alter column product_id drop not null;
update public.stock_ledgers
set filament_id = product_id, product_id = null
where product_id in (select id from public.filaments);
alter table public.stock_ledgers
  add constraint stock_ledgers_item_check check ((product_id is not null) <> (filament_id is not null));
create index stock_ledgers_filament_idx on public.stock_ledgers (tenant_id, filament_id);

alter table public.material_lots add column filament_id uuid references public.filaments (id);
alter table public.material_lots alter column product_id drop not null;
update public.material_lots
set filament_id = product_id, product_id = null
where product_id in (select id from public.filaments);
alter table public.material_lots
  add constraint material_lots_item_check check ((product_id is not null) <> (filament_id is not null));
create index material_lots_filament_idx on public.material_lots (tenant_id, filament_id);

alter table public.spools drop constraint spools_product_id_fkey;
alter table public.spools rename column product_id to filament_id;
alter table public.spools
  add constraint spools_filament_id_fkey foreign key (filament_id) references public.filaments (id);
create index spools_filament_idx on public.spools (tenant_id, filament_id);

alter table public.cycle_count_lines add column filament_id uuid references public.filaments (id);
alter table public.cycle_count_lines alter column product_id drop not null;
update public.cycle_count_lines
set filament_id = product_id, product_id = null
where product_id in (select id from public.filaments);
alter table public.cycle_count_lines
  add constraint cycle_count_lines_item_check check ((product_id is not null) <> (filament_id is not null));

alter table public.bom_lines add column component_filament_id uuid references public.filaments (id);
alter table public.bom_lines alter column component_product_id drop not null;
update public.bom_lines
set component_filament_id = component_product_id, component_product_id = null
where component_product_id in (select id from public.filaments);
alter table public.bom_lines
  add constraint bom_lines_component_check check ((component_product_id is not null) <> (component_filament_id is not null));
create index bom_lines_filament_idx on public.bom_lines (component_filament_id);

alter table public.production_order_materials add column component_filament_id uuid references public.filaments (id);
alter table public.production_order_materials alter column component_product_id drop not null;
update public.production_order_materials
set component_filament_id = component_product_id, component_product_id = null
where component_product_id in (select id from public.filaments);
alter table public.production_order_materials
  add constraint production_order_materials_component_check check ((component_product_id is not null) <> (component_filament_id is not null));
create index production_order_materials_filament_idx on public.production_order_materials (component_filament_id);

alter table public.production_consumptions add column filament_id uuid references public.filaments (id);
alter table public.production_consumptions alter column product_id drop not null;
update public.production_consumptions
set filament_id = product_id, product_id = null
where product_id in (select id from public.filaments);
alter table public.production_consumptions
  add constraint production_consumptions_item_check check ((product_id is not null) <> (filament_id is not null));

alter table public.purchase_order_lines add column filament_id uuid references public.filaments (id);
alter table public.purchase_order_lines alter column product_id drop not null;
update public.purchase_order_lines
set filament_id = product_id, product_id = null
where product_id in (select id from public.filaments);
alter table public.purchase_order_lines
  add constraint purchase_order_lines_item_check check ((product_id is not null) <> (filament_id is not null));
create index purchase_order_lines_filament_idx on public.purchase_order_lines (filament_id);

alter table public.receipt_lines add column filament_id uuid references public.filaments (id);
alter table public.receipt_lines alter column product_id drop not null;
update public.receipt_lines
set filament_id = product_id, product_id = null
where product_id in (select id from public.filaments);
alter table public.receipt_lines
  add constraint receipt_lines_item_check check ((product_id is not null) <> (filament_id is not null));

alter table public.mrp_planned_orders add column filament_id uuid references public.filaments (id);
alter table public.mrp_planned_orders alter column product_id drop not null;
update public.mrp_planned_orders
set filament_id = product_id, product_id = null
where product_id in (select id from public.filaments);
alter table public.mrp_planned_orders
  add constraint mrp_planned_orders_item_check check ((product_id is not null) <> (filament_id is not null));
create index mrp_planned_orders_filament_idx on public.mrp_planned_orders (filament_id);

alter table public.sales_order_lines add column filament_id uuid references public.filaments (id);
update public.sales_order_lines
set filament_id = product_id, product_id = null, line_kind = 'filament'
where product_id in (select id from public.filaments);
alter table public.sales_order_lines drop constraint sales_order_lines_target_check;
alter table public.sales_order_lines
  add constraint sales_order_lines_target_check check (
    (line_kind = 'product' and product_id is not null and filament_id is null and service_id is null)
    or (line_kind = 'filament' and filament_id is not null and product_id is null and service_id is null)
    or (line_kind = 'service' and service_id is not null and product_id is null and filament_id is null)
  );
create index sales_order_lines_filament_idx on public.sales_order_lines (tenant_id, filament_id);

-- La cotización conserva descripción, unidad, precios y una copia del id. Sin llave foránea.
alter table public.quote_lines add column sku text not null default '';
alter table public.quote_lines add column catalog_id uuid;

update public.quote_lines as line
set
  catalog_id = coalesce(line.product_id, line.service_id),
  sku = coalesce(
    (select sku from public.products where id = line.product_id),
    (select sku from public.filaments where id = line.product_id),
    (select code from public.service_offerings where id = line.service_id),
    ''
  );

alter table public.quotes add column payment_terms text not null default 'pue';
update public.quotes as quote
set payment_terms = customer.payment_terms
from public.customers as customer
where customer.id = quote.customer_id;

alter table public.quote_lines drop constraint quote_lines_kind_check;
alter table public.quote_lines drop constraint quote_lines_target_check;
alter table public.quote_lines drop column product_id;
alter table public.quote_lines drop column service_id;
alter table public.quote_lines
  add constraint quote_lines_kind_check check (line_kind in ('product', 'filament', 'service'));

delete from public.products where product_type = 'raw_material';

alter table public.products drop constraint products_type_check;
alter table public.products
  add constraint products_type_check check (product_type in ('component', 'finished_good', 'service'));

insert into public.schema_migrations (id) values ('0013_filaments_quote_snapshots');

commit;
