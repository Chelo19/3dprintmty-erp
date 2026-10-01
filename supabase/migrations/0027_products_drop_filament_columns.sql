-- Los filamentos viven en su propia tabla desde 0013. En productos estas columnas
-- quedaron vacías y los valores por omisión seguían siendo de filamento (G/KG × 1000).

drop view public.products_visible;

alter table public.products
  drop column material,
  drop column color,
  drop column diameter_mm;

alter table public.products alter column stock_uom set default 'EA';
alter table public.products alter column purchase_uom set default 'EA';
alter table public.products alter column uom_factor set default 1;

create view public.products_visible
with (security_barrier = true) as
select
  p.id,
  p.tenant_id,
  p.sku,
  p.name,
  p.product_type,
  p.status,
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

grant select on public.products_visible to authenticated;

insert into public.schema_migrations (id) values ('0027_products_drop_filament_columns');
