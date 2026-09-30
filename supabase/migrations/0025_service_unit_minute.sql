alter table public.service_offerings
  drop constraint service_offerings_unit_check,
  add constraint service_offerings_unit_check check (unit in ('minuto', 'hora', 'pieza', 'servicio'));

insert into public.schema_migrations (id) values ('0025_service_unit_minute');
