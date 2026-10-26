begin;

-- El RFC de público en general identifica un tratamiento fiscal, no a un cliente único.
-- Los RFC particulares siguen siendo únicos dentro de cada taller.
drop index public.customers_rfc_unique;
create unique index customers_rfc_unique on public.customers (tenant_id, rfc)
  where rfc is not null and rfc <> 'XAXX010101000';

insert into public.schema_migrations(id) values ('20261026011655_allow_public_rfc_multiple_customers');
commit;
