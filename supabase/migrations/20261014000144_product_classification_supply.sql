begin;
set local lock_timeout = '10s';
alter table public.products add column item_class text, add column supply_mode text;
update public.products set
 item_class = case when product_type = 'resale' then 'finished_good' else product_type end,
 supply_mode = case when product_type = 'finished_good' then 'make' else 'buy' end;
update public.products p set supply_mode = 'both' where p.product_type = 'finished_good' and exists (select 1 from public.purchase_order_lines l where l.product_id = p.id);
alter table public.products
 alter column item_class set not null, alter column supply_mode set not null,
 add constraint products_item_class_check check (item_class in ('finished_good','component','raw_material','service')),
 add constraint products_supply_mode_check check (supply_mode in ('make','buy','both')),
 add constraint products_service_supply_check check (item_class <> 'service' or supply_mode = 'buy');
create index products_class_supply_idx on public.products(tenant_id, item_class, supply_mode, created_at desc);
-- Compatibilidad con capturas e integraciones que todavía envían product_type.
-- Las columnas nuevas son la fuente de verdad; product_type conserva el contrato anterior.
create function public.sync_product_classification() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
 if tg_op = 'UPDATE' then
   if new.product_type is distinct from old.product_type and new.item_class = old.item_class and new.supply_mode = old.supply_mode then
     new.item_class := case when new.product_type = 'resale' then 'finished_good' else new.product_type end;
     new.supply_mode := case when new.product_type = 'finished_good' then 'make' else 'buy' end;
   end if;
 end if;
 new.item_class := coalesce(new.item_class, case when new.product_type = 'resale' then 'finished_good' else new.product_type end);
 new.supply_mode := coalesce(new.supply_mode, case when new.product_type = 'finished_good' then 'make' else 'buy' end);
 new.product_type := case when new.item_class = 'finished_good' and new.supply_mode = 'buy' then 'resale' else new.item_class end;
 return new;
end $$;
revoke all on function public.sync_product_classification() from public, authenticated, anon;
create trigger sync_product_classification before insert or update on public.products
 for each row execute function public.sync_product_classification();
create or replace view public.products_visible with (security_barrier = true, security_invoker = true) as
select p.id,p.tenant_id,p.sku,p.name,p.product_type,p.status,p.stock_uom,p.purchase_uom,p.uom_factor,p.cost_minor,
 case when public.jwt_role() = 'production' then null else p.sale_price_minor end as sale_price_minor,
 p.created_by,p.created_at,p.updated_at,p.qc_rigor,p.item_class,p.supply_mode
from public.products p where public.can_access_tenant(p.tenant_id);
revoke all on public.products_visible from authenticated, anon, public;
grant select on public.products_visible to erp_api;
insert into public.schema_migrations(id) values ('20261014000144_product_classification_supply');
commit;
