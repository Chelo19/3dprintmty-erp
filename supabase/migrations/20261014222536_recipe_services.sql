begin;
create table public.bom_service_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  bom_id uuid not null,
  service_id uuid not null,
  quantity numeric(18,4) not null check (quantity > 0),
  constraint bom_service_lines_bom_fk foreign key (tenant_id, bom_id) references public.boms(tenant_id,id),
  constraint bom_service_lines_service_fk foreign key (tenant_id, service_id) references public.service_offerings(tenant_id,id),
  constraint bom_service_lines_unique unique (tenant_id,bom_id,service_id)
);
create index bom_service_lines_service_idx on public.bom_service_lines(tenant_id,service_id);
revoke all on public.bom_service_lines from public, anon, authenticated;
select public.apply_tenant_rls('bom_service_lines', array['owner','admin','production']);
alter table public.production_orders add column service_cost_minor bigint not null default 0 check (service_cost_minor >= 0);
insert into public.schema_migrations(id) values ('20261014222536_recipe_services');
commit;
