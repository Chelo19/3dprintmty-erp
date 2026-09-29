begin;

create table public.stock_balances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  product_id uuid not null references public.products (id),
  location_id uuid not null references public.locations (id),
  on_hand numeric(14, 4) not null default 0,
  allocated numeric(14, 4) not null default 0,
  reorder_point numeric(14, 4) not null default 0,
  lead_time_days integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_balances_unique unique (tenant_id, product_id, location_id),
  constraint stock_balances_allocated_check check (allocated >= 0),
  constraint stock_balances_reorder_check check (reorder_point >= 0),
  constraint stock_balances_lead_time_check check (lead_time_days >= 0)
);

create index stock_balances_tenant_product_idx on public.stock_balances (tenant_id, product_id);

create table public.stock_ledgers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  product_id uuid not null references public.products (id),
  location_id uuid not null references public.locations (id),
  kind text not null,
  quantity numeric(14, 4) not null,
  reason text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint stock_ledgers_kind_check check (
    kind in ('receipt', 'issue', 'adjustment', 'reservation', 'release', 'scrap', 'transfer')
  ),
  constraint stock_ledgers_quantity_check check (quantity <> 0)
);

create index stock_ledgers_tenant_product_idx on public.stock_ledgers (tenant_id, product_id, created_at desc);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  kind text not null,
  legal_name text not null,
  rfc text,
  phone text,
  payment_terms text not null default 'pue',
  credit_limit_minor bigint not null default 0,
  status text not null default 'active',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_kind_check check (kind in ('b2b', 'b2c')),
  constraint customers_terms_check check (payment_terms in ('pue', 'net_15', 'net_30')),
  constraint customers_status_check check (status in ('active', 'inactive', 'suspended')),
  constraint customers_credit_check check (credit_limit_minor >= 0)
);

create index customers_tenant_status_idx on public.customers (tenant_id, status);
create unique index customers_rfc_unique on public.customers (tenant_id, rfc) where rfc is not null;

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  customer_id uuid not null references public.customers (id),
  kind text not null,
  line1 text not null,
  neighborhood text not null,
  postal_code text not null,
  state text not null,
  country_code text not null default 'MX',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint customer_addresses_kind_check check (kind in ('fiscal', 'shipping'))
);

create index customer_addresses_customer_idx on public.customer_addresses (tenant_id, customer_id);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  folio text not null,
  customer_id uuid not null references public.customers (id),
  customer_name text not null,
  customer_rfc text,
  status text not null default 'draft',
  valid_until timestamptz not null,
  currency text not null default 'MXN',
  subtotal_minor bigint not null,
  discount_minor bigint not null default 0,
  vat_minor bigint not null,
  total_minor bigint not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_folio_unique unique (tenant_id, folio),
  constraint quotes_status_check check (status in ('draft', 'sent', 'accepted', 'converted', 'expired', 'void'))
);

create index quotes_tenant_status_idx on public.quotes (tenant_id, status);

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  quote_id uuid not null references public.quotes (id),
  product_id uuid references public.products (id),
  description text not null,
  quantity numeric(14, 4) not null,
  unit_price_minor bigint not null,
  discount_minor bigint not null default 0,
  net_minor bigint not null,
  vat_minor bigint not null,
  total_minor bigint not null,
  created_at timestamptz not null default now(),
  constraint quote_lines_quantity_check check (quantity > 0)
);

create index quote_lines_quote_idx on public.quote_lines (tenant_id, quote_id);

create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  folio text not null,
  quote_id uuid references public.quotes (id),
  customer_id uuid not null references public.customers (id),
  customer_name text not null,
  customer_rfc text,
  status text not null default 'draft',
  payment_status text not null default 'pending',
  fulfillment_status text not null default 'pending',
  currency text not null default 'MXN',
  subtotal_minor bigint not null,
  discount_minor bigint not null default 0,
  shipping_minor bigint not null default 0,
  vat_minor bigint not null,
  total_minor bigint not null,
  credit_override_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_orders_folio_unique unique (tenant_id, folio),
  constraint sales_orders_status_check check (
    status in (
      'draft', 'pending', 'confirmed', 'in_production', 'ready_to_ship',
      'shipped', 'delivered', 'completed', 'on_hold', 'cancelled'
    )
  ),
  constraint sales_orders_payment_check check (
    payment_status in ('pending', 'partial', 'paid', 'refunded', 'cancelled')
  ),
  constraint sales_orders_fulfillment_check check (
    fulfillment_status in ('pending', 'ready', 'picking', 'packing', 'shipped', 'delivered')
  )
);

create index sales_orders_tenant_customer_idx on public.sales_orders (tenant_id, customer_id, payment_status);

create table public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  sales_order_id uuid not null references public.sales_orders (id),
  product_id uuid references public.products (id),
  description text not null,
  quantity numeric(14, 4) not null,
  unit_price_minor bigint not null,
  discount_minor bigint not null default 0,
  net_minor bigint not null,
  vat_minor bigint not null,
  total_minor bigint not null,
  created_at timestamptz not null default now(),
  constraint sales_order_lines_quantity_check check (quantity > 0)
);

create index sales_order_lines_order_idx on public.sales_order_lines (tenant_id, sales_order_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  sales_order_id uuid not null references public.sales_orders (id),
  method text not null,
  kind text not null default 'payment',
  status text not null default 'completed',
  amount_minor bigint not null,
  reference text,
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint payments_method_check check (method in ('efectivo', 'spei', 'tarjeta', 'cod')),
  constraint payments_kind_check check (kind in ('payment', 'refund')),
  constraint payments_status_check check (status in ('pending', 'completed', 'failed', 'voided')),
  constraint payments_amount_check check (amount_minor > 0)
);

create index payments_order_idx on public.payments (tenant_id, sales_order_id);

create trigger stock_balances_updated_at
before update on public.stock_balances
for each row execute function public.set_updated_at();

create trigger customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

create trigger quotes_updated_at
before update on public.quotes
for each row execute function public.set_updated_at();

create trigger sales_orders_updated_at
before update on public.sales_orders
for each row execute function public.set_updated_at();

alter table public.stock_balances enable row level security;
alter table public.stock_balances force row level security;
alter table public.stock_ledgers enable row level security;
alter table public.stock_ledgers force row level security;
alter table public.customers enable row level security;
alter table public.customers force row level security;
alter table public.customer_addresses enable row level security;
alter table public.customer_addresses force row level security;
alter table public.quotes enable row level security;
alter table public.quotes force row level security;
alter table public.quote_lines enable row level security;
alter table public.quote_lines force row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_orders force row level security;
alter table public.sales_order_lines enable row level security;
alter table public.sales_order_lines force row level security;
alter table public.payments enable row level security;
alter table public.payments force row level security;

create policy stock_balances_select on public.stock_balances
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy stock_balances_write on public.stock_balances
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
);

create policy stock_balances_update on public.stock_balances
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
);

create policy stock_ledgers_select on public.stock_ledgers
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy stock_ledgers_insert on public.stock_ledgers
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
);

create policy customers_select on public.customers
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy customers_write on public.customers
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy customers_update on public.customers
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy customer_addresses_select on public.customer_addresses
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy customer_addresses_write on public.customer_addresses
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy quotes_select on public.quotes
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy quotes_write on public.quotes
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy quotes_update on public.quotes
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy quote_lines_select on public.quote_lines
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy quote_lines_write on public.quote_lines
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy sales_orders_select on public.sales_orders
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy sales_orders_write on public.sales_orders
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy sales_orders_update on public.sales_orders
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy sales_order_lines_select on public.sales_order_lines
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy sales_order_lines_write on public.sales_order_lines
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy payments_select on public.payments
for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy payments_insert on public.payments
for insert to authenticated
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy payments_update on public.payments
for update to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

grant select, insert, update on public.stock_balances to authenticated;
grant select, insert on public.stock_ledgers to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, insert on public.customer_addresses to authenticated;
grant select, insert, update on public.quotes to authenticated;
grant select, insert on public.quote_lines to authenticated;
grant select, insert, update on public.sales_orders to authenticated;
grant select, insert on public.sales_order_lines to authenticated;
grant select, insert, update on public.payments to authenticated;

insert into public.schema_migrations (id) values ('0002_operations');

commit;
