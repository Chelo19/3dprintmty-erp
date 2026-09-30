-- La resolución de una impresión (prestado, retrabajo, condonar) es de la pieza,
-- no de cada servicio que la compone.

create table public.sales_order_prints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  sales_order_id uuid not null references public.sales_orders (id),
  position integer not null default 0,
  name text not null,
  quantity numeric(14, 4) not null,
  resolution text not null default 'pending',
  resolution_note text,
  created_at timestamptz not null default now(),
  constraint sales_order_prints_quantity_check check (quantity > 0),
  constraint sales_order_prints_resolution_check check (
    resolution in ('pending', 'in_progress', 'delivered', 'accepted', 'rework', 'waived')
  )
);

create index sales_order_prints_order_idx on public.sales_order_prints (tenant_id, sales_order_id, position);

alter table public.sales_order_lines
  add column print_id uuid references public.sales_order_prints (id) on delete set null;

create index sales_order_lines_print_idx on public.sales_order_lines (print_id);

select public.apply_tenant_rls('sales_order_prints', array['owner', 'admin', 'sales'], true);

-- Pedidos que nacieron de una cotización por impresiones recuperan el grupo.
with inserted as (
  insert into public.sales_order_prints (tenant_id, sales_order_id, position, name, quantity)
  select qp.tenant_id, so.id, qp.position, qp.name, qp.quantity
  from public.quote_prints qp
  join public.sales_orders so on so.quote_id = qp.quote_id
  returning id, sales_order_id, position, name
)
update public.sales_order_lines sol
set print_id = inserted.id
from public.sales_orders so
join public.quote_lines ql on ql.quote_id = so.quote_id
join public.quote_prints qp on qp.id = ql.print_id
join inserted
  on inserted.sales_order_id = so.id
 and inserted.position = qp.position
 and inserted.name = qp.name
where sol.sales_order_id = so.id
  and sol.position = ql.position;

-- Si todos los servicios de la impresión ya estaban cerrados, la impresión también.
update public.sales_order_prints p
set resolution = 'delivered'
where exists (
  select 1 from public.sales_order_lines l
  where l.print_id = p.id and l.line_kind = 'service'
)
and not exists (
  select 1 from public.sales_order_lines l
  where l.print_id = p.id
    and l.line_kind = 'service'
    and l.resolution not in ('delivered', 'accepted', 'waived')
);

insert into public.schema_migrations (id) values ('0015_order_prints');
