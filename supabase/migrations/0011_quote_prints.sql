begin;

alter table public.quotes
  add column mode text not null default 'products',
  add constraint quotes_mode_check check (mode in ('prints', 'products'));

create table public.quote_prints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  quote_id uuid not null references public.quotes (id),
  position integer not null default 0,
  name text not null,
  quantity numeric(14, 4) not null,
  created_at timestamptz not null default now(),
  constraint quote_prints_quantity_check check (quantity > 0)
);

create index quote_prints_quote_idx on public.quote_prints (tenant_id, quote_id, position);

alter table public.quote_prints enable row level security;
alter table public.quote_prints force row level security;

create policy quote_prints_select on public.quote_prints
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy quote_prints_insert on public.quote_prints
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

grant select, insert on public.quote_prints to authenticated;

alter table public.quote_lines
  add column print_id uuid references public.quote_prints (id);

create index quote_lines_print_idx on public.quote_lines (tenant_id, print_id);

insert into public.schema_migrations (id) values ('0011_quote_prints');

commit;
