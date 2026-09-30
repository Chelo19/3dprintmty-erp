-- Costo interno del servicio, para ver su margen contra el precio.

alter table public.service_offerings
  add column cost_minor bigint,
  add constraint service_offerings_cost_check check (cost_minor is null or cost_minor >= 0);

insert into public.schema_migrations (id) values ('0023_service_cost');
