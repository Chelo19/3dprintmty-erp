begin;

create table public.service_offerings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  code text not null,
  name text not null,
  description text,
  unit text not null default 'servicio',
  sale_price_minor bigint,
  terms text not null default '',
  status text not null default 'active',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_offerings_code_unique unique (tenant_id, code),
  constraint service_offerings_unit_check check (unit in ('hora', 'pieza', 'servicio')),
  constraint service_offerings_status_check check (status in ('active', 'inactive')),
  constraint service_offerings_price_check check (sale_price_minor is null or sale_price_minor >= 0)
);

create index service_offerings_tenant_status_idx on public.service_offerings (tenant_id, status);

create trigger service_offerings_updated_at
before update on public.service_offerings
for each row execute function public.set_updated_at();

alter table public.service_offerings enable row level security;
alter table public.service_offerings force row level security;

create policy service_offerings_select on public.service_offerings
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy service_offerings_insert on public.service_offerings
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy service_offerings_update on public.service_offerings
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

grant select, insert, update on public.service_offerings to authenticated;

alter table public.quotes
  add column service_terms text;

alter table public.sales_orders
  add column service_terms text;

alter table public.quote_lines
  add column position integer not null default 0,
  add column service_id uuid references public.service_offerings (id),
  add column line_kind text not null default 'product',
  add column terms text,
  add constraint quote_lines_kind_check check (line_kind in ('product', 'service')),
  add constraint quote_lines_target_check check (
    (line_kind = 'product' and service_id is null)
    or (line_kind = 'service' and product_id is null and service_id is not null)
  );

create index quote_lines_service_idx on public.quote_lines (tenant_id, service_id);

alter table public.sales_order_lines
  add column service_id uuid references public.service_offerings (id),
  add column line_kind text not null default 'product',
  add column terms text,
  add column resolution text not null default 'pending',
  add column resolution_note text,
  add constraint sales_order_lines_kind_check check (line_kind in ('product', 'service')),
  add constraint sales_order_lines_target_check check (
    (line_kind = 'product' and service_id is null)
    or (line_kind = 'service' and product_id is null and service_id is not null)
  ),
  add constraint sales_order_lines_resolution_check check (
    resolution in ('pending', 'in_progress', 'delivered', 'accepted', 'rework', 'waived')
  );

create index sales_order_lines_service_idx on public.sales_order_lines (tenant_id, service_id);

insert into public.schema_migrations (id) values ('0008_services');

commit;
