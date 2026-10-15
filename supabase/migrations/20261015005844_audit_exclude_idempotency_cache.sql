begin;
set local lock_timeout = '5s';
-- Internal response caches can contain sensitive payloads; audit business effects instead.
drop trigger if exists record_author on public.idempotency_requests;
drop trigger if exists record_audit on public.idempotency_requests;
create or replace function public.enable_record_audit(target text)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if target in ('audit_events','platform_audit_log','idempotency_keys','idempotency_requests') then return; end if;
  execute format('create trigger record_author before insert or update on public.%I for each row execute function public.guard_record_author()', target);
  execute format('create trigger record_audit after insert or update or delete on public.%I for each row execute function public.audit_record_change()', target);
end; $$;
revoke all on function public.enable_record_audit(text) from public, anon, authenticated, erp_api;
insert into public.schema_migrations(id) values ('20261015005844_audit_exclude_idempotency_cache');
commit;
