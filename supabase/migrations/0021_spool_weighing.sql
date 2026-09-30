-- La existencia del filamento se ajusta al pesar cada rollo, no al imprimir un pedido.

create table public.spools (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  spool_number text not null,
  filament_id uuid not null references public.filaments (id),
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

create index spools_filament_idx on public.spools (tenant_id, filament_id, status);

create table public.spool_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  spool_id uuid not null references public.spools (id),
  kind text not null,
  grams numeric(14, 4) not null,
  reason text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint spool_events_kind_check check (kind in ('receipt', 'adjust', 'scrap'))
);

create index spool_events_spool_idx on public.spool_events (tenant_id, spool_id, created_at desc);

create trigger spools_updated_at
before update on public.spools
for each row execute function public.set_updated_at();

select public.apply_tenant_rls('spools', array['owner', 'admin', 'warehouse', 'production']);
select public.apply_tenant_rls('spool_events', array['owner', 'admin', 'warehouse', 'production']);

insert into public.schema_migrations (id) values ('0021_spool_weighing');
