begin;

alter table public.payments add column paid_on date;
-- Los pagos anteriores solo contaban con su fecha de captura; se conserva como referencia histórica.
update public.payments payment set paid_on =
  (payment.created_at at time zone coalesce((select company.timezone from public.company_profiles company where company.tenant_id=payment.tenant_id), 'America/Mexico_City'))::date
where payment.status='completed';

-- Cubre POS, integraciones anteriores y confirmaciones contra entrega, sin cambiar created_at.
create function public.set_payment_effective_date() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare workshop_timezone text;
begin
  if new.status='completed' and new.paid_on is null then
    select timezone into workshop_timezone from public.company_profiles where tenant_id=new.tenant_id;
    new.paid_on := (current_timestamp at time zone coalesce(workshop_timezone,'America/Mexico_City'))::date;
  end if;
  return new;
end;
$$;
revoke all on function public.set_payment_effective_date() from public, anon, authenticated, erp_api;
create trigger payment_effective_date before insert or update of status, paid_on on public.payments
for each row execute function public.set_payment_effective_date();
alter table public.payments add constraint payments_completed_date_check check (status <> 'completed' or paid_on is not null);
create index payments_tenant_paid_on_idx on public.payments(tenant_id,paid_on desc,created_at desc);
insert into public.schema_migrations(id) values ('20261027213802_payment_effective_date');
commit;
