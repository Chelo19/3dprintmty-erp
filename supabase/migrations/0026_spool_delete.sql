-- Borrar un rollo capturado por error; su peso actual sale del inventario.

create policy spools_delete on public.spools
for delete to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
);

grant delete on public.spools to authenticated;

create policy spool_events_delete on public.spool_events
for delete to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'warehouse')
);

grant delete on public.spool_events to authenticated;

insert into public.schema_migrations (id) values ('0026_spool_delete');
