-- Fase 3: prefactura (documento comercial, no CFDI) y perfil fiscal del receptor.
begin;

alter table public.customers add column tax_regime text;
alter table public.customers add column cfdi_use text not null default 'G03';
alter table public.customers add column billing_email text;

create table public.commercial_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  kind text not null default 'prefactura',
  sales_order_id uuid not null references public.sales_orders (id),
  series text not null,
  folio integer not null,
  status text not null default 'issued',
  title text not null,
  emitter jsonb not null,
  receiver jsonb not null,
  intended_payment text not null,
  sat_payment_form text not null,
  currency text not null default 'MXN',
  subtotal_minor bigint not null,
  discount_minor bigint not null default 0,
  shipping_minor bigint not null default 0,
  vat_minor bigint not null,
  total_minor bigint not null,
  incomplete boolean not null default false,
  warnings jsonb not null default '[]'::jsonb,
  issued_at timestamptz not null default now(),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_documents_folio_unique unique (tenant_id, series, folio),
  constraint commercial_documents_kind_check check (kind in ('prefactura')),
  constraint commercial_documents_status_check check (status in ('issued', 'void')),
  constraint commercial_documents_payment_check check (intended_payment in ('PUE', 'PPD')),
  constraint commercial_documents_void_check check (
    status <> 'void' or (void_reason is not null and voided_at is not null)
  )
);

-- Una prefactura vigente por pedido en el MVP.
create unique index commercial_documents_one_active
  on public.commercial_documents (tenant_id, sales_order_id)
  where status = 'issued';

create index commercial_documents_issued_idx on public.commercial_documents (tenant_id, issued_at desc);

create table public.commercial_document_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  document_id uuid not null references public.commercial_documents (id),
  description text not null,
  quantity numeric(14, 4) not null,
  unit_price_minor bigint not null,
  discount_minor bigint not null default 0,
  net_minor bigint not null,
  vat_minor bigint not null,
  total_minor bigint not null
);

create index commercial_document_lines_document_idx on public.commercial_document_lines (tenant_id, document_id);

create trigger commercial_documents_updated_at
before update on public.commercial_documents
for each row execute function public.set_updated_at();

-- Producción no lee importes de venta.
select public.apply_tenant_rls(
  'commercial_documents',
  array['owner', 'admin', 'sales'],
  false,
  array['owner', 'admin', 'sales', 'viewer', 'warehouse']
);
select public.apply_tenant_rls(
  'commercial_document_lines',
  array['owner', 'admin', 'sales'],
  false,
  array['owner', 'admin', 'sales', 'viewer', 'warehouse']
);

insert into public.schema_migrations (id) values ('0006_prefacturas');

commit;
