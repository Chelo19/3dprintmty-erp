-- Un servicio comprado se describe en el gasto. No apunta al catálogo de servicios que vendemos.

alter table public.expenses drop constraint expenses_target_check;
alter table public.expenses add constraint expenses_target_check check (
  (kind = 'product' and product_id is not null and filament_id is null and service_id is null)
  or (kind = 'filament' and filament_id is not null and product_id is null and service_id is null)
  or (kind = 'service' and product_id is null and filament_id is null)
  or (kind = 'other' and product_id is null and filament_id is null and service_id is null)
);

insert into public.schema_migrations (id) values ('0018_expense_services');
