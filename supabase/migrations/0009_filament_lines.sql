begin;

alter table public.quote_lines drop constraint quote_lines_kind_check;
alter table public.quote_lines drop constraint quote_lines_target_check;

alter table public.quote_lines
  add constraint quote_lines_kind_check check (line_kind in ('product', 'filament', 'service')),
  add constraint quote_lines_target_check check (
    (line_kind in ('product', 'filament') and service_id is null)
    or (line_kind = 'service' and product_id is null and service_id is not null)
  );

alter table public.sales_order_lines drop constraint sales_order_lines_kind_check;
alter table public.sales_order_lines drop constraint sales_order_lines_target_check;

alter table public.sales_order_lines
  add constraint sales_order_lines_kind_check check (line_kind in ('product', 'filament', 'service')),
  add constraint sales_order_lines_target_check check (
    (line_kind in ('product', 'filament') and service_id is null)
    or (line_kind = 'service' and product_id is null and service_id is not null)
  );

insert into public.schema_migrations (id) values ('0009_filament_lines');

commit;
