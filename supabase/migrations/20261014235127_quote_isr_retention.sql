begin;
set local lock_timeout = '5s';
alter table public.company_profiles add column default_isr_rate numeric(8,6) not null default 0 check (default_isr_rate between 0 and 1);
do $$
declare target text;
begin
  foreach target in array array['quotes','sales_orders','commercial_documents'] loop
    execute format('alter table public.%I add column vat_rate numeric(8,6) not null default 0.16 check(vat_rate between 0 and 1), add column isr_rate numeric(8,6) not null default 0 check(isr_rate between 0 and 1), add column isr_withheld_minor bigint not null default 0 check(isr_withheld_minor >= 0)', target);
    execute format('alter table public.%I disable trigger %I', target, target || '_updated_at');
    -- El histórico anterior usaba exclusivamente 0, 8 o 16 %. Conservar importes.
    execute format('update public.%I set vat_rate = case when vat_minor = 0 then 0 when abs(vat_minor - round(subtotal_minor * 0.08)) < abs(vat_minor - round(subtotal_minor * 0.16)) then 0.08 else 0.16 end', target);
    execute format('alter table public.%I enable trigger %I', target, target || '_updated_at');
  end loop;
end $$;
insert into public.schema_migrations(id) values ('20261014235127_quote_isr_retention');
commit;
