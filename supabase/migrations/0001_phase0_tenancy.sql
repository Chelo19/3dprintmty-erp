-- Fase 0: tenancy, RLS, empresa, locaciones, catálogo mínimo, auditoría.
-- Las políticas leen el JWT de la sesión (request.jwt.claims), no un filtro del cliente.
-- gen_random_uuid() vive en el núcleo de Postgres 13+, sin extensión.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

grant usage on schema public to authenticated;

create or replace function public.jwt_claims()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Misma bolsa que usa auth.jwt() en Supabase: request.jwt.claims.
  -- plpgsql evita que el rol authenticated se meta al esquema auth por inline.
  return coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
end;
$$;

create or replace function public.jwt_user_id()
returns uuid
language sql
stable
as $$
  select nullif(public.jwt_claims() ->> 'sub', '')::uuid;
$$;

create or replace function public.jwt_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(public.jwt_claims() ->> 'tenant_id', '')::uuid;
$$;

create or replace function public.jwt_role()
returns text
language sql
stable
as $$
  select nullif(public.jwt_claims() ->> 'role', '');
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table public.user_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text,
  created_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references public.user_accounts (id),
  created_at timestamptz not null default now()
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  status text not null default 'pending',
  country_code text not null default 'MX',
  plan text not null default 'beta',
  rfc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_status_check check (status in ('pending', 'active', 'suspended')),
  constraint tenants_rfc_unique unique (rfc),
  constraint tenants_rfc_format check (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$')
);

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  user_id uuid not null references public.user_accounts (id),
  role text not null,
  email text not null,
  created_at timestamptz not null default now(),
  constraint tenant_memberships_unique unique (tenant_id, user_id),
  constraint tenant_memberships_user_unique unique (user_id),
  constraint tenant_memberships_role_check check (
    role in ('owner', 'admin', 'sales', 'production', 'warehouse', 'viewer')
  )
);

create index tenant_memberships_tenant_idx on public.tenant_memberships (tenant_id);

create table public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null,
  tenant_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.company_profiles (
  tenant_id uuid primary key references public.tenants (id),
  legal_name text not null,
  trade_name text,
  rfc text not null,
  tax_regime text not null,
  fiscal_postal_code text not null,
  currency text not null default 'MXN',
  timezone text not null default 'America/Mexico_City',
  locale text not null default 'es-MX',
  default_vat_rate numeric(6, 4) not null default 0.1600,
  preinvoice_series text not null default 'A',
  privacy_accepted_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_profiles_rfc_unique unique (rfc),
  constraint company_profiles_cp_check check (fiscal_postal_code ~ '^[0-9]{5}$')
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  kind text not null default 'warehouse',
  postal_code text not null,
  state text not null,
  country_code text not null default 'MX',
  is_default boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_kind_check check (kind in ('warehouse', 'floor', 'showroom')),
  constraint locations_cp_check check (postal_code ~ '^[0-9]{5}$')
);

create index locations_tenant_idx on public.locations (tenant_id);

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  rate numeric(6, 4) not null,
  is_default boolean not null default false,
  country_code text not null default 'MX',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_rates_tenant_name unique (tenant_id, name)
);

create index tax_rates_tenant_idx on public.tax_rates (tenant_id);

create table public.payment_method_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  method text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_method_settings_unique unique (tenant_id, method),
  constraint payment_method_settings_method_check check (
    method in ('efectivo', 'spei', 'tarjeta', 'mercadopago', 'conekta', 'stripe', 'cod', 'credito')
  )
);

create table public.number_sequences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  doc_type text not null,
  series text not null,
  next_folio bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint number_sequences_unique unique (tenant_id, doc_type, series)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  sku text not null,
  name text not null,
  product_type text not null,
  status text not null default 'active',
  material text,
  color text,
  diameter_mm numeric(4, 2),
  stock_uom text not null default 'G',
  purchase_uom text not null default 'KG',
  uom_factor numeric(12, 4) not null default 1000,
  cost_minor bigint,
  sale_price_minor bigint,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_sku_unique unique (tenant_id, sku),
  constraint products_type_check check (
    product_type in ('raw_material', 'component', 'finished_good', 'service')
  ),
  constraint products_status_check check (status in ('active', 'inactive'))
);

create index products_tenant_idx on public.products (tenant_id);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_tenant_idx on public.audit_events (tenant_id, created_at desc);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  email text not null,
  role text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint invitations_role_check check (
    role in ('admin', 'sales', 'production', 'warehouse', 'viewer')
  )
);

create index invitations_tenant_idx on public.invitations (tenant_id);

create table public.idempotency_keys (
  user_id uuid not null references public.user_accounts (id),
  key text not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create or replace function public.can_access_tenant(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.tenant_memberships m
      where m.tenant_id = tid
        and m.user_id = public.jwt_user_id()
    )
    or exists (
      select 1
      from public.platform_admins p
      where p.user_id = nullif(public.jwt_claims() ->> 'impersonator', '')::uuid
        and tid = public.jwt_tenant_id()
    );
$$;

create view public.products_visible
with (security_barrier = true) as
select
  p.id,
  p.tenant_id,
  p.sku,
  p.name,
  p.product_type,
  p.status,
  p.material,
  p.color,
  p.diameter_mm,
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
  p.updated_at
from public.products p
where public.can_access_tenant(p.tenant_id);

create trigger tenants_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

create trigger company_profiles_updated_at
before update on public.company_profiles
for each row execute function public.set_updated_at();

create trigger locations_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

create trigger tax_rates_updated_at
before update on public.tax_rates
for each row execute function public.set_updated_at();

create trigger payment_method_settings_updated_at
before update on public.payment_method_settings
for each row execute function public.set_updated_at();

create trigger number_sequences_updated_at
before update on public.number_sequences
for each row execute function public.set_updated_at();

create trigger products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

alter table public.tenants enable row level security;
alter table public.tenants force row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_memberships force row level security;
alter table public.company_profiles enable row level security;
alter table public.company_profiles force row level security;
alter table public.locations enable row level security;
alter table public.locations force row level security;
alter table public.tax_rates enable row level security;
alter table public.tax_rates force row level security;
alter table public.payment_method_settings enable row level security;
alter table public.payment_method_settings force row level security;
alter table public.number_sequences enable row level security;
alter table public.number_sequences force row level security;
alter table public.products enable row level security;
alter table public.products force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.invitations enable row level security;
alter table public.invitations force row level security;
alter table public.user_accounts enable row level security;
alter table public.user_accounts force row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
alter table public.platform_audit_log enable row level security;
alter table public.platform_audit_log force row level security;
alter table public.idempotency_keys enable row level security;
alter table public.idempotency_keys force row level security;

create policy tenants_select on public.tenants
for select to authenticated
using (id = public.jwt_tenant_id() and public.can_access_tenant(id));

create policy tenants_update on public.tenants
for update to authenticated
using (id = public.jwt_tenant_id() and public.jwt_role() = 'owner')
with check (id = public.jwt_tenant_id() and public.jwt_role() = 'owner');

create policy memberships_select on public.tenant_memberships
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy company_select on public.company_profiles
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy company_update on public.company_profiles
for update to authenticated
using (public.can_access_tenant(tenant_id) and public.jwt_role() = 'owner')
with check (public.can_access_tenant(tenant_id) and public.jwt_role() = 'owner');

create policy locations_select on public.locations
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy locations_write on public.locations
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
);

create policy locations_update on public.locations
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
);

create policy tax_select on public.tax_rates
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy tax_write on public.tax_rates
for all to authenticated
using (public.can_access_tenant(tenant_id) and public.jwt_role() = 'owner')
with check (public.can_access_tenant(tenant_id) and public.jwt_role() = 'owner');

create policy payments_select on public.payment_method_settings
for select to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy payments_write on public.payment_method_settings
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin')
);

create policy sequences_select on public.number_sequences
for select to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin')
);

create policy products_select on public.products
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy products_insert on public.products
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
);

create policy products_update on public.products
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
);

create policy audit_select on public.audit_events
for select to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin')
);

create policy audit_insert on public.audit_events
for insert to authenticated
with check (public.can_access_tenant(tenant_id));

create policy invitations_all on public.invitations
for all to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin')
);

revoke all on public.user_accounts from authenticated;
revoke all on public.platform_admins from authenticated;
revoke all on public.platform_audit_log from authenticated;
revoke all on public.idempotency_keys from authenticated;

grant select, insert, update, delete on public.tenants to authenticated;
grant select on public.tenant_memberships to authenticated;
grant select, update on public.company_profiles to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, update, delete on public.tax_rates to authenticated;
grant select, update on public.payment_method_settings to authenticated;
grant select on public.number_sequences to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert on public.audit_events to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
grant select on public.products_visible to authenticated;
revoke select (sale_price_minor) on public.products from authenticated;

grant execute on function public.can_access_tenant(uuid) to authenticated;
grant execute on function public.jwt_claims() to authenticated;
grant execute on function public.jwt_user_id() to authenticated;
grant execute on function public.jwt_tenant_id() to authenticated;
grant execute on function public.jwt_role() to authenticated;

do $$
begin
  execute format('grant authenticated to %I', current_user);
exception
  when insufficient_privilege then
    null;
end
$$;

insert into public.schema_migrations (id) values ('0001_phase0_tenancy');
