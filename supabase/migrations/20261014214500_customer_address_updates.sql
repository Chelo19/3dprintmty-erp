begin;

-- El domicilio se edita desde la API, con los mismos roles que el cliente.
grant update (line1, neighborhood, postal_code, state, country_code)
  on public.customer_addresses to erp_api;

create policy customer_addresses_update on public.customer_addresses
for update to erp_api
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
)
with check (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

insert into public.schema_migrations (id) values ('20261014214500_customer_address_updates');
commit;
