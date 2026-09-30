-- Editar un borrador reemplaza impresiones y partidas. El clon nace como borrador nuevo.

create policy quote_lines_delete on public.quote_lines
for delete to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

create policy quote_prints_delete on public.quote_prints
for delete to authenticated
using (
  public.can_access_tenant(tenant_id)
  and public.jwt_role() in ('owner', 'admin', 'sales')
);

grant delete on public.quote_lines to authenticated;
grant delete on public.quote_prints to authenticated;

insert into public.schema_migrations (id) values ('0020_quote_clone_edit');
