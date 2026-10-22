begin;

-- Partidas comerciales sin alta de catálogo; mantienen los snapshots e impuestos existentes.
alter table public.quote_lines drop constraint quote_lines_kind_check;
alter table public.quote_lines add constraint quote_lines_kind_check
  check (line_kind in ('product', 'filament', 'service', 'temporary'));
alter table public.quote_lines add constraint quote_lines_temporary_check
  check (line_kind <> 'temporary' or (catalog_id is null and print_id is null));

alter table public.sales_order_lines drop constraint sales_order_lines_kind_check;
alter table public.sales_order_lines add constraint sales_order_lines_kind_check
  check (line_kind in ('product', 'filament', 'service', 'temporary'));
alter table public.sales_order_lines drop constraint sales_order_lines_target_check;
alter table public.sales_order_lines add constraint sales_order_lines_target_check check (
  (line_kind = 'product' and product_id is not null and filament_id is null and service_id is null)
  or (line_kind = 'filament' and filament_id is not null and product_id is null and service_id is null)
  or (line_kind = 'service' and service_id is not null and product_id is null and filament_id is null)
  or (line_kind = 'temporary' and product_id is null and filament_id is null and service_id is null
      and print_id is null and reserved_qty = 0 and shipped_qty = 0)
);

insert into public.schema_migrations(id) values ('20261021235351_temporary_quote_lines');
commit;
