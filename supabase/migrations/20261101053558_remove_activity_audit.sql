begin;
set local lock_timeout = '5s';

-- Remove only event logging triggers. Keep record_author and all business history.
do $$ declare item record;
begin
  for item in select n.nspname as schema_name, c.relname as table_name, t.tgname
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and t.tgfoid='public.audit_record_change()'::regprocedure
  loop execute format('drop trigger %I on %I.%I',item.tgname,item.schema_name,item.table_name); end loop;
end $$;

create function public.enable_record_author(target text)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if target in ('platform_audit_log','idempotency_keys','idempotency_requests') then return; end if;
  execute format('create trigger record_author before insert or update on public.%I for each row execute function public.guard_record_author()', target);
end; $$;
revoke all on function public.enable_record_author(text) from public, anon, authenticated, erp_api;

create or replace function public.apply_tenant_rls(
  target text,
  writers text[],
  allow_delete boolean default false,
  readers text[] default null
)
returns void
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  writer_list text := array_to_string(array(select quote_literal(r) from unnest(writers) as r), ', ');
  reader_check text := '';
begin
  if readers is not null then
    reader_check := format(
      ' and public.jwt_role() in (%s)',
      array_to_string(array(select quote_literal(r) from unnest(readers) as r), ', ')
    );
  end if;
  execute format('alter table public.%I enable row level security', target);
  execute format('alter table public.%I force row level security', target);
  execute format(
    'create policy %I on public.%I for select to erp_api using (public.can_access_tenant(tenant_id)%s)',
    target || '_select', target, reader_check
  );
  execute format(
    'create policy %I on public.%I for insert to erp_api with check (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s))',
    target || '_insert', target, writer_list
  );
  execute format(
    'create policy %I on public.%I for update to erp_api using (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s)) with check (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s))',
    target || '_update', target, writer_list, writer_list
  );
  execute format('grant select, insert, update on public.%I to erp_api', target);
  if allow_delete then
    execute format(
      'create policy %I on public.%I for delete to erp_api using (public.can_access_tenant(tenant_id) and public.jwt_role() in (%s))',
      target || '_delete', target, writer_list
    );
    execute format('grant delete on public.%I to erp_api', target);
  end if;
  perform public.enable_record_author(target);
end;
$$;

revoke all on function public.apply_tenant_rls(text,text[],boolean,text[]) from public, anon, authenticated, erp_api;
drop function public.enable_record_audit(text);
drop function public.audit_record_change();
-- Explicitly requested retirement: deletes the accumulated activity log and its indexes.
drop table public.audit_events;
drop function public.guard_audit_event();

insert into public.schema_migrations(id) values ('20261101053558_remove_activity_audit');
commit;
