begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Abortar ante diferencias: nunca elegir silenciosamente qué dato fiscal conservar.
do $$
begin
  if exists (select 1 from public.tenants t left join public.company_profiles p on p.tenant_id=t.id where p.tenant_id is null or t.rfc is distinct from p.rfc) then
    raise exception 'Los RFC de taller y perfil fiscal deben coincidir antes de simplificar';
  end if;
  if exists (select 1 from public.company_profiles p where (select count(*) from public.tax_rates r where r.tenant_id=p.tenant_id and r.is_default) <> 1) then
    raise exception 'Cada perfil debe tener exactamente una tasa predeterminada';
  end if;
  if exists (select 1 from public.company_profiles p join public.tax_rates r on r.tenant_id=p.tenant_id and r.is_default where p.default_vat_rate is distinct from r.rate) then
    raise exception 'Las tasas de IVA deben coincidir antes de simplificar';
  end if;
end $$;

-- Clasificación canónica; el campo de respuesta antiguo sigue disponible y es derivado.
drop view public.products_visible;
drop trigger sync_product_classification on public.products;
drop function public.sync_product_classification();
alter table public.products drop column product_type;
alter table public.products add column product_type text generated always as (
  case when item_class='finished_good' and supply_mode='buy' then 'resale' else item_class end
) stored not null;
create view public.products_visible with (security_barrier=true, security_invoker=true) as
select p.id,p.tenant_id,p.sku,p.name,p.product_type,p.status,p.stock_uom,p.purchase_uom,p.uom_factor,p.cost_minor,
 case when public.jwt_role()='production' then null else p.sale_price_minor end as sale_price_minor,
 p.created_by,p.created_at,p.updated_at,p.qc_rigor,p.item_class,p.supply_mode
from public.products p where public.can_access_tenant(p.tenant_id);
revoke all on public.products_visible from public, authenticated, anon;
grant select on public.products_visible to erp_api;

-- La entidad SaaS y el perfil fiscal siguen separados, con un solo RFC maestro.
alter table public.company_profiles add constraint company_profiles_rfc_format
 check (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$');
alter table public.tenants drop column rfc;

-- Una sola tasa: el perfil apunta al catálogo. La selección predeterminada vive en el perfil.
alter table public.tax_rates add constraint tax_rates_tenant_id_id_unique unique (tenant_id,id);
alter table public.company_profiles add column default_tax_rate_id uuid;
alter table public.company_profiles disable trigger company_profiles_updated_at;
update public.company_profiles p set default_tax_rate_id=r.id
from public.tax_rates r where r.tenant_id=p.tenant_id and r.is_default;
alter table public.company_profiles enable trigger company_profiles_updated_at;
alter table public.company_profiles
 alter column default_tax_rate_id set not null,
 add constraint company_profiles_default_tax_rate_fk foreign key (tenant_id, default_tax_rate_id)
 references public.tax_rates(tenant_id,id),
 drop column default_vat_rate;
alter table public.tax_rates drop column is_default;

-- Archivo privado: conserva íntegra la historia anterior, sin agregar una tabla de negocio.
create schema if not exists erp_archive;
revoke all on schema erp_archive from public, authenticated, anon, erp_api;
alter table public.idempotency_keys set schema erp_archive;
revoke all on erp_archive.idempotency_keys from public, authenticated, anon, erp_api;

-- Solo retirar índices del inventario revisado y comprobar equivalencia en ejecución.
do $$
declare pair record; identical boolean;
begin
  for pair in select * from (values
    ('erp_production_order_materials_production_order_id_idx','production_order_materials_order_idx'),
    ('erp_production_order_operations_production_order_id_idx','production_order_operations_order_idx'),
    ('erp_production_orders_sales_order_id_idx','production_orders_sales_order_idx'),
    ('erp_customer_addresses_customer_id_idx','customer_addresses_customer_idx'),
    ('erp_payments_sales_order_id_idx','payments_order_idx'),
    ('erp_quote_lines_quote_id_idx','quote_lines_quote_idx'),
    ('erp_quote_lines_print_id_idx','quote_lines_print_idx'),
    ('erp_receipt_lines_receipt_id_idx','receipt_lines_receipt_idx'),
    ('erp_material_lots_product_id_idx','material_lots_product_idx'),
    ('erp_material_lots_filament_id_idx','material_lots_filament_idx'),
    ('erp_routing_operations_routing_id_idx','routing_operations_routing_idx'),
    ('erp_sales_order_lines_sales_order_id_idx','sales_order_lines_order_idx'),
    ('erp_sales_order_lines_service_id_idx','sales_order_lines_service_idx'),
    ('erp_sales_order_lines_filament_id_idx','sales_order_lines_filament_idx'),
    ('erp_bom_lines_bom_id_idx','bom_lines_bom_idx'),
    ('erp_inspections_production_order_id_idx','inspections_order_idx'),
    ('erp_production_consumptions_production_order_id_idx','production_consumptions_order_idx'),
    ('erp_purchase_order_lines_purchase_order_id_idx','purchase_order_lines_order_idx'),
    ('erp_sales_orders_location_id_idx','sales_orders_location_idx'),
    ('erp_commercial_document_lines_document_id_idx','commercial_document_lines_document_idx'),
    ('erp_stock_balances_product_id_idx','stock_balances_tenant_product_idx'),
    ('erp_stock_balances_filament_id_idx','stock_balances_filament_idx'),
    ('erp_stock_ledgers_filament_id_idx','stock_ledgers_filament_idx')
  ) as reviewed(remove_name,keep_name)
  loop
    if to_regclass('public.'||pair.remove_name) is null then continue; end if;
    select exists (
      select 1 from pg_index a join pg_class ac on ac.oid=a.indexrelid
      join pg_namespace n on n.oid=ac.relnamespace
      join pg_index b on b.indrelid=a.indrelid join pg_class bc on bc.oid=b.indexrelid
      where n.nspname='public' and ac.relname=pair.remove_name and bc.relname=pair.keep_name
       and a.indkey=b.indkey and a.indclass=b.indclass and a.indcollation=b.indcollation
       and a.indoption=b.indoption and a.indnkeyatts=b.indnkeyatts
       and a.indisunique=b.indisunique and not a.indisunique
       and a.indisvalid and b.indisvalid and a.indisready and b.indisready
       and ac.relam=bc.relam and ac.reloptions is not distinct from bc.reloptions
       and pg_get_expr(a.indpred,a.indrelid) is not distinct from pg_get_expr(b.indpred,b.indrelid)
       and pg_get_expr(a.indexprs,a.indrelid) is not distinct from pg_get_expr(b.indexprs,b.indrelid)
       and not exists(select 1 from pg_constraint c where c.conindid=a.indexrelid)
    ) into identical;
    if not identical then raise exception 'El índice % ya no es equivalente a %',pair.remove_name,pair.keep_name; end if;
    execute format('drop index public.%I',pair.remove_name);
  end loop;
end $$;

-- La FK compuesta conserva la relación y exige que ambos lados pertenezcan al mismo taller.
do $$
declare pair record; old_fk record; new_fk record;
begin
  for pair in select * from (values
    ('expense_payments','expense_payments_expense_id_fkey','erp_expense_payments_expense_id_fk'),
    ('production_order_materials','production_order_materials_component_filament_id_fkey','erp_production_order_materials_component_filament_id_fk'),
    ('production_order_materials','production_order_materials_component_product_id_fkey','erp_production_order_materials_component_product_id_fk'),
    ('production_order_materials','production_order_materials_production_order_id_fkey','erp_production_order_materials_production_order_id_fk'),
    ('production_order_operations','production_order_operations_production_order_id_fkey','erp_production_order_operations_production_order_id_fk'),
    ('production_order_operations','production_order_operations_work_center_id_fkey','erp_production_order_operations_work_center_id_fk'),
    ('production_orders','production_orders_bom_id_fkey','erp_production_orders_bom_id_fk'),
    ('production_orders','production_orders_location_id_fkey','erp_production_orders_location_id_fk'),
    ('production_orders','production_orders_product_id_fkey','erp_production_orders_product_id_fk'),
    ('production_orders','production_orders_routing_id_fkey','erp_production_orders_routing_id_fk'),
    ('production_orders','production_orders_sales_order_id_fkey','erp_production_orders_sales_order_id_fk'),
    ('customer_addresses','customer_addresses_customer_id_fkey','erp_customer_addresses_customer_id_fk'),
    ('payments','payments_sales_order_id_fkey','erp_payments_sales_order_id_fk'),
    ('quote_lines','quote_lines_print_id_fkey','erp_quote_lines_print_id_fk'),
    ('quote_lines','quote_lines_quote_id_fkey','erp_quote_lines_quote_id_fk'),
    ('quote_prints','quote_prints_quote_id_fkey','erp_quote_prints_quote_id_fk'),
    ('quotes','quotes_customer_id_fkey','erp_quotes_customer_id_fk'),
    ('receipt_lines','receipt_lines_filament_id_fkey','erp_receipt_lines_filament_id_fk'),
    ('receipt_lines','receipt_lines_lot_id_fkey','erp_receipt_lines_lot_id_fk'),
    ('receipt_lines','receipt_lines_product_id_fkey','erp_receipt_lines_product_id_fk'),
    ('receipt_lines','receipt_lines_purchase_order_line_id_fkey','erp_receipt_lines_purchase_order_line_id_fk'),
    ('receipt_lines','receipt_lines_receipt_id_fkey','erp_receipt_lines_receipt_id_fk'),
    ('material_lots','material_lots_filament_id_fkey','erp_material_lots_filament_id_fk'),
    ('material_lots','material_lots_product_id_fkey','erp_material_lots_product_id_fk'),
    ('material_lots','material_lots_purchase_order_id_fkey','erp_material_lots_purchase_order_id_fk'),
    ('material_lots','material_lots_receipt_id_fkey','erp_material_lots_receipt_id_fk'),
    ('material_lots','material_lots_vendor_id_fkey','erp_material_lots_vendor_id_fk'),
    ('routing_operations','routing_operations_routing_id_fkey','erp_routing_operations_routing_id_fk'),
    ('routing_operations','routing_operations_work_center_id_fkey','erp_routing_operations_work_center_id_fk'),
    ('routings','routings_product_id_fkey','erp_routings_product_id_fk'),
    ('sales_order_events','sales_order_events_sales_order_id_fkey','erp_sales_order_events_sales_order_id_fk'),
    ('sales_order_lines','sales_order_lines_filament_id_fkey','erp_sales_order_lines_filament_id_fk'),
    ('sales_order_lines','sales_order_lines_print_id_fkey','erp_sales_order_lines_print_id_fk'),
    ('sales_order_lines','sales_order_lines_product_id_fkey','erp_sales_order_lines_product_id_fk'),
    ('sales_order_lines','sales_order_lines_sales_order_id_fkey','erp_sales_order_lines_sales_order_id_fk'),
    ('sales_order_lines','sales_order_lines_service_id_fkey','erp_sales_order_lines_service_id_fk'),
    ('sales_order_prints','sales_order_prints_sales_order_id_fkey','erp_sales_order_prints_sales_order_id_fk'),
    ('bom_lines','bom_lines_bom_id_fkey','erp_bom_lines_bom_id_fk'),
    ('bom_lines','bom_lines_component_filament_id_fkey','erp_bom_lines_component_filament_id_fk'),
    ('bom_lines','bom_lines_component_product_id_fkey','erp_bom_lines_component_product_id_fk'),
    ('boms','boms_product_id_fkey','erp_boms_product_id_fk'),
    ('inspections','inspections_defect_type_id_fkey','erp_inspections_defect_type_id_fk'),
    ('inspections','inspections_production_order_id_fkey','erp_inspections_production_order_id_fk'),
    ('production_consumptions','production_consumptions_filament_id_fkey','erp_production_consumptions_filament_id_fk'),
    ('production_consumptions','production_consumptions_lot_id_fkey','erp_production_consumptions_lot_id_fk'),
    ('production_consumptions','production_consumptions_material_id_fkey','erp_production_consumptions_material_id_fk'),
    ('production_consumptions','production_consumptions_product_id_fkey','erp_production_consumptions_product_id_fk'),
    ('production_consumptions','production_consumptions_production_order_id_fkey','erp_production_consumptions_production_order_id_fk'),
    ('purchase_order_lines','purchase_order_lines_filament_id_fkey','erp_purchase_order_lines_filament_id_fk'),
    ('purchase_order_lines','purchase_order_lines_product_id_fkey','erp_purchase_order_lines_product_id_fk'),
    ('purchase_order_lines','purchase_order_lines_purchase_order_id_fkey','erp_purchase_order_lines_purchase_order_id_fk'),
    ('purchase_orders','purchase_orders_location_id_fkey','erp_purchase_orders_location_id_fk'),
    ('purchase_orders','purchase_orders_vendor_id_fkey','erp_purchase_orders_vendor_id_fk'),
    ('receipts','receipts_location_id_fkey','erp_receipts_location_id_fk'),
    ('receipts','receipts_purchase_order_id_fkey','erp_receipts_purchase_order_id_fk'),
    ('sales_orders','sales_orders_customer_id_fkey','erp_sales_orders_customer_id_fk'),
    ('sales_orders','sales_orders_location_id_fkey','erp_sales_orders_location_id_fk'),
    ('sales_orders','sales_orders_quote_id_fkey','erp_sales_orders_quote_id_fk'),
    ('commercial_documents','commercial_documents_sales_order_id_fkey','erp_commercial_documents_sales_order_id_fk'),
    ('commercial_document_lines','commercial_document_lines_document_id_fkey','erp_commercial_document_lines_document_id_fk'),
    ('stock_balances','stock_balances_filament_id_fkey','erp_stock_balances_filament_id_fk'),
    ('stock_balances','stock_balances_location_id_fkey','erp_stock_balances_location_id_fk'),
    ('stock_balances','stock_balances_product_id_fkey','erp_stock_balances_product_id_fk'),
    ('expenses','expenses_filament_id_fkey','erp_expenses_filament_id_fk'),
    ('expenses','expenses_product_id_fkey','erp_expenses_product_id_fk'),
    ('expenses','expenses_purchase_order_id_fkey','erp_expenses_purchase_order_id_fk'),
    ('expenses','expenses_service_id_fkey','erp_expenses_service_id_fk'),
    ('stock_ledgers','stock_ledgers_filament_id_fkey','erp_stock_ledgers_filament_id_fk'),
    ('stock_ledgers','stock_ledgers_location_id_fkey','erp_stock_ledgers_location_id_fk'),
    ('stock_ledgers','stock_ledgers_lot_id_fkey','erp_stock_ledgers_lot_id_fk'),
    ('stock_ledgers','stock_ledgers_product_id_fkey','erp_stock_ledgers_product_id_fk'),
    ('spool_events','spool_events_spool_id_fkey','erp_spool_events_spool_id_fk'),
    ('spools','spools_filament_id_fkey','erp_spools_filament_id_fk'),
    ('spools','spools_location_id_fkey','erp_spools_location_id_fk'),
    ('spools','spools_lot_id_fkey','erp_spools_lot_id_fk')
  ) as reviewed(table_name,simple_name,compound_name)
  loop
    select * into old_fk from pg_constraint where conrelid=to_regclass('public.'||pair.table_name) and conname=pair.simple_name;
    if not found then continue; end if;
    select * into new_fk from pg_constraint where conrelid=old_fk.conrelid and conname=pair.compound_name;
    if not found then raise exception 'Falta la FK compuesta %',pair.compound_name; end if;
    if old_fk.contype<>'f' or new_fk.contype<>'f' or not new_fk.convalidated
      or array_length(old_fk.conkey,1)<>1 or array_length(new_fk.conkey,1)<>2
      or old_fk.confrelid<>new_fk.confrelid or old_fk.conkey[1]<>new_fk.conkey[2]
      or old_fk.confkey[1]<>new_fk.confkey[2] or old_fk.confdeltype<>new_fk.confdeltype
      or old_fk.confupdtype<>new_fk.confupdtype or old_fk.confmatchtype<>new_fk.confmatchtype
      or old_fk.condeferrable<>new_fk.condeferrable or old_fk.condeferred<>new_fk.condeferred
      or not exists(select 1 from pg_attribute where attrelid=new_fk.conrelid and attnum=new_fk.conkey[1] and attname='tenant_id' and attnotnull)
      or not exists(select 1 from pg_attribute where attrelid=new_fk.confrelid and attnum=new_fk.confkey[1] and attname='tenant_id') then
      raise exception 'Las FKs % y % ya no son equivalentes',pair.simple_name,pair.compound_name;
    end if;
    if old_fk.confdeltype in ('n','d') and new_fk.confdelsetcols is distinct from old_fk.conkey then
      raise exception 'La acción de borrado de % debe afectar solo la columna original',pair.compound_name;
    end if;
    execute format('alter table public.%I drop constraint %I',pair.table_name,pair.simple_name);
  end loop;
end $$;

insert into public.schema_migrations(id) values ('20261014210912_simplify_database_foundations');
commit;
