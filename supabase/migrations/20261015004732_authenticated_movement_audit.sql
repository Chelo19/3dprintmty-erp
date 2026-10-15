begin;
set local lock_timeout = '5s';

-- The API supplies these claims from the authenticated session, never from request bodies.
-- Keep the existing tenant-scoped, owner/admin-only audit_events table.
create or replace function public.guard_audit_event()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare claims jsonb := public.jwt_claims(); actor uuid := public.jwt_user_id();
begin
  if tg_op <> 'INSERT' then
    raise exception 'La bitácora es inmutable: no se puede modificar ni borrar.' using errcode = '42501';
  end if;
  if actor is not null then
    if new.actor_user_id is not null and new.actor_user_id <> actor then
      raise exception 'El autor debe ser el usuario autenticado.' using errcode = '42501';
    end if;
    new.actor_user_id := actor;
    new.created_at := clock_timestamp();
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'actorEmail', claims->>'email', 'actorRole', claims->>'role',
      'impersonator', claims->>'impersonator', 'transactionId', txid_current()::text,
      'origin', case when current_user = 'erp_api' then 'user' else 'administrative' end
    );
  elsif current_user = 'erp_api' then
    raise exception 'No se puede registrar una acción sin usuario autenticado.' using errcode = '42501';
  else
    -- No fabricated attribution for database maintenance or legacy explicit events.
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'origin', 'system', 'transactionId', txid_current()::text
    );
  end if;
  return new;
end; $$;
revoke all on function public.guard_audit_event() from public, anon, authenticated, erp_api;
create trigger audit_event_signature before insert or update or delete on public.audit_events
for each row execute function public.guard_audit_event();
create trigger audit_event_no_truncate before truncate on public.audit_events
for each statement execute function public.guard_audit_event();
revoke update, delete, truncate on public.audit_events from erp_api, authenticated, anon, public;

-- Preserve authorship on source records that already have created_by.
create or replace function public.guard_record_author()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare actor uuid := public.jwt_user_id(); data jsonb := to_jsonb(new);
begin
  if current_user = 'erp_api' and actor is null then
    raise exception 'Toda modificación requiere un usuario autenticado.' using errcode = '42501';
  end if;
  if actor is not null and data ? 'created_by' then
    if tg_op = 'INSERT' then
      if nullif(data->>'created_by', '') is not null and (data->>'created_by')::uuid <> actor then
        raise exception 'No se puede registrar un movimiento a nombre de otro usuario.' using errcode = '42501';
      end if;
      new := jsonb_populate_record(new, jsonb_build_object('created_by', actor));
    elsif (data->'created_by') is distinct from (to_jsonb(old)->'created_by') then
      raise exception 'No se puede cambiar el autor original del registro.' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_record_author() from public, anon, authenticated, erp_api;

create or replace function public.audit_record_change()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  before_row jsonb; after_row jsonb; row_data jsonb; tenant uuid; entity uuid; changed jsonb;
  -- Never copy credentials or invitation tokens into the audit trail.
  secrets text[] := array['password_hash', 'token_hash', 'access_token', 'refresh_token', 'secret', 'token'];
begin
  before_row := case when tg_op <> 'INSERT' then to_jsonb(old) - secrets else null end;
  after_row := case when tg_op <> 'DELETE' then to_jsonb(new) - secrets else null end;
  if tg_op = 'UPDATE' and (before_row - 'updated_at') = (after_row - 'updated_at') then return new; end if;
  row_data := coalesce(after_row, before_row);
  tenant := coalesce(nullif(row_data->>'tenant_id',''), case when tg_table_name = 'tenants' then row_data->>'id' end)::uuid;
  if tenant is null then return coalesce(new, old); end if;
  if current_user = 'erp_api' and (public.jwt_user_id() is null or tenant is distinct from public.jwt_tenant_id()) then
    raise exception 'La firma no corresponde al taller autenticado.' using errcode = '42501';
  end if;
  entity := coalesce(nullif(row_data->>'id',''), nullif(row_data->>'user_id',''), tenant::text)::uuid;
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into changed
  from jsonb_object_keys(coalesce(before_row,'{}') || coalesce(after_row,'{}')) as fields(key)
  where key <> 'updated_at' and (before_row->key) is distinct from (after_row->key);
  insert into public.audit_events(tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (tenant, public.jwt_user_id(), 'record.' || lower(tg_op), tg_table_name, entity,
    jsonb_build_object('before', before_row, 'after', after_row, 'changedFields', changed, 'source', 'database'));
  return coalesce(new, old);
end; $$;
revoke all on function public.audit_record_change() from public, anon, authenticated, erp_api;

create or replace function public.enable_record_audit(target text)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if target in ('audit_events','platform_audit_log','idempotency_keys') then return; end if;
  execute format('create trigger record_author before insert or update on public.%I for each row execute function public.guard_record_author()', target);
  execute format('create trigger record_audit after insert or update or delete on public.%I for each row execute function public.audit_record_change()', target);
end; $$;
revoke all on function public.enable_record_audit(text) from public, anon, authenticated, erp_api;

do $$ declare item record;
begin
  for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname not in ('audit_events','platform_audit_log','idempotency_keys')
    and (c.relname='tenants' or exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped))
  loop perform public.enable_record_audit(item.relname); end loop;
end; $$;

-- Cover new modules that use the project's standard tenancy helper.
create or replace function public.apply_tenant_rls(
  target text,
  writers text[],
  allow_delete boolean default false,
  readers text[] default null
)
returns void
language plpgsql
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
  perform public.enable_record_audit(target);
end;
$$;

revoke all on function public.apply_tenant_rls(text,text[],boolean,text[]) from public, anon, authenticated, erp_api;
create index audit_events_entity_history_idx on public.audit_events(tenant_id,entity_type,entity_id,created_at desc,id desc);
create index audit_events_actor_history_idx on public.audit_events(tenant_id,actor_user_id,created_at desc,id desc);
create index audit_events_timeline_idx on public.audit_events(tenant_id,created_at desc,id desc);
insert into public.schema_migrations(id) values ('20261015004732_authenticated_movement_audit');
commit;
