begin;

-- Una cabecera financiera y N partidas; las recepciones conservan los movimientos físicos.
alter table public.expenses drop constraint expenses_kind_check;
alter table public.expenses add constraint expenses_kind_check check (kind in ('product', 'filament', 'service', 'other', 'mixed'));
alter table public.expenses drop constraint expenses_target_check;
alter table public.expenses add constraint expenses_target_check check (
  (kind = 'product' and product_id is not null and filament_id is null and service_id is null)
  or (kind = 'filament' and filament_id is not null and product_id is null and service_id is null)
  or (kind = 'service' and product_id is null and filament_id is null)
  or (kind in ('other', 'mixed') and product_id is null and filament_id is null and service_id is null)
);
create table public.expense_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  expense_id uuid not null,
  position integer not null check (position >= 0),
  kind text not null check (kind in ('product', 'filament', 'service', 'other')),
  product_id uuid,
  filament_id uuid,
  description text not null,
  quantity numeric(14,4) not null check (quantity > 0),
  purchase_uom text not null,
  uom_factor numeric(12,4) not null check (uom_factor > 0),
  amount_minor bigint not null check (amount_minor >= 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, expense_id, position),
  foreign key (tenant_id, expense_id) references public.expenses(tenant_id,id),
  foreign key (tenant_id, product_id) references public.products(tenant_id,id),
  foreign key (tenant_id, filament_id) references public.filaments(tenant_id,id),
  constraint expense_lines_target_check check (
    (kind = 'product' and product_id is not null and filament_id is null)
    or (kind = 'filament' and filament_id is not null and product_id is null)
    or (kind in ('service', 'other') and product_id is null and filament_id is null)
  )
);
-- Copia los datos históricos sin modificar importes, abonos, inventarios ni autores.
insert into public.expense_lines(tenant_id,expense_id,position,kind,product_id,filament_id,description,quantity,purchase_uom,uom_factor,amount_minor,created_by,created_at)
select e.tenant_id,e.id,0,e.kind,e.product_id,e.filament_id,e.description,e.quantity,
  coalesce(received.purchase_uom, case when e.kind='filament' then 'KG' else coalesce(p.purchase_uom,'PZA') end),
  coalesce(received.uom_factor, case when e.kind='filament' then 1000 else coalesce(p.uom_factor,1) end),
  e.amount_minor,e.created_by,e.created_at
from public.expenses e left join public.products p on p.id=e.product_id and p.tenant_id=e.tenant_id
left join lateral (
  select line.purchase_uom, line.uom_factor from public.receipt_lines line
  join public.receipts receipt on receipt.id=line.receipt_id and receipt.tenant_id=line.tenant_id
  where receipt.expense_id=e.id and receipt.tenant_id=e.tenant_id
    and (line.product_id=e.product_id or line.filament_id=e.filament_id)
  order by receipt.created_at, line.id limit 1
) received on true;
select public.apply_tenant_rls('expense_lines', array['owner','admin','warehouse'], false, array['owner','admin','warehouse','viewer']);
insert into public.schema_migrations(id) values ('20261027210904_multiple_purchase_lines');
commit;
