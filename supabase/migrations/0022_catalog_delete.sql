-- Borrar un artículo del catálogo que todavía no se usó en el taller.

create policy products_delete on public.products
for delete to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
);

create policy filaments_delete on public.filaments
for delete to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
);

grant delete on public.filaments to authenticated;

create policy service_offerings_delete on public.service_offerings
for delete to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

grant delete on public.service_offerings to authenticated;

insert into public.schema_migrations (id) values ('0022_catalog_delete');
