begin;
set local lock_timeout = '5s';

-- Retain historical OC content in the immutable audit trail, without an active OC table.
insert into public.audit_events(tenant_id, action, entity_type, entity_id, metadata)
select p.tenant_id, 'purchase_order.archived', 'purchase_orders', p.id,
  jsonb_build_object('before', to_jsonb(p), 'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.purchase_order_lines l where l.tenant_id=p.tenant_id and l.purchase_order_id=p.id),'[]'::jsonb), 'reason','Órdenes de compra fuera del alcance actual', 'source','migration')
from public.purchase_orders p;

alter table public.receipts
  add column expense_id uuid,
  add column vendor_id uuid,
  add column source_folio text;
alter table public.receipt_lines
  add column description text not null default '',
  add column purchase_uom text not null default 'PZA',
  add column uom_factor numeric(12,4) not null default 1 check(uom_factor > 0),
  add column unit_cost_minor bigint not null default 0 check(unit_cost_minor >= 0);
alter table public.material_lots add column expense_id uuid;

do $$ begin
  if exists(select 1 from public.expenses where purchase_order_id is not null group by tenant_id,purchase_order_id having count(*)>1) then
    raise exception 'Una OC tiene varios gastos; se requiere conservar sus asociaciones antes de retirarla.';
  end if;
end; $$;
update public.receipts r set expense_id=e.id
from public.expenses e where r.tenant_id=e.tenant_id and r.purchase_order_id=e.purchase_order_id;
update public.receipts r set vendor_id=p.vendor_id, source_folio=p.folio
from public.purchase_orders p where r.tenant_id=p.tenant_id and r.purchase_order_id=p.id;
update public.receipt_lines r set description=l.description, purchase_uom=l.purchase_uom, uom_factor=l.uom_factor, unit_cost_minor=l.unit_cost_minor
from public.purchase_order_lines l where r.tenant_id=l.tenant_id and r.purchase_order_line_id=l.id;
update public.material_lots l set expense_id=e.id
from public.expenses e where l.tenant_id=e.tenant_id and l.purchase_order_id=e.purchase_order_id;

alter table public.receipts add constraint erp_receipts_expense_id_fk foreign key(tenant_id,expense_id) references public.expenses(tenant_id,id);
alter table public.receipts add constraint erp_receipts_vendor_id_fk foreign key(tenant_id,vendor_id) references public.vendors(tenant_id,id);
alter table public.material_lots add constraint erp_material_lots_expense_id_fk foreign key(tenant_id,expense_id) references public.expenses(tenant_id,id);
create index receipts_expense_idx on public.receipts(tenant_id,expense_id);
create index material_lots_expense_idx on public.material_lots(tenant_id,expense_id);

alter table public.receipt_lines drop column purchase_order_line_id;
alter table public.receipts drop column purchase_order_id;
alter table public.material_lots drop column purchase_order_id;
alter table public.expenses drop column purchase_order_id;
drop table public.purchase_order_lines;
drop table public.purchase_orders;
insert into public.schema_migrations(id) values ('20261015011845_remove_purchase_orders_keep_direct_purchases');
commit;
