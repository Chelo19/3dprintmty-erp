begin;
set local lock_timeout = '5s';

-- Snapshot taxes per line; existing monetary amounts stay unchanged.
alter table quote_lines
  add column vat_rate numeric(8,6) not null default 0.16 check (vat_rate between 0 and 1),
  add column vat_exempt boolean not null default false,
  add column isr_rate numeric(8,6) not null default 0 check (isr_rate between 0 and 1),
  add column isr_withheld_minor bigint not null default 0 check (isr_withheld_minor >= 0);

-- Preserve historical aggregate ISR exactly, including cent rounding.
with bases as (
  select l.id, p.vat_rate, p.isr_rate, p.isr_withheld_minor,
    l.net_minor::numeric as weight,
    sum(l.net_minor::numeric) over (partition by p.id) as base,
    p.id as parent_id
  from quote_lines l join quotes p on p.id = l.quote_id and p.tenant_id = l.tenant_id
), shares as (
  select *, case when base > 0 then floor(isr_withheld_minor * weight / base) else 0 end as share,
    case when base > 0 then mod(isr_withheld_minor * weight, base) else 0 end as remainder
  from bases
), allocated as (
  select *, sum(share) over (partition by parent_id) as assigned,
    row_number() over (partition by parent_id order by remainder desc, id) as rank
  from shares
)
update quote_lines l set vat_rate = a.vat_rate, isr_rate = a.isr_rate,
  isr_withheld_minor = (a.share + case when a.base > 0 and a.rank <= a.isr_withheld_minor - a.assigned then 1 else 0 end)::bigint
from allocated a where l.id = a.id;

alter table sales_order_lines
  add column vat_rate numeric(8,6) not null default 0.16 check (vat_rate between 0 and 1),
  add column vat_exempt boolean not null default false,
  add column isr_rate numeric(8,6) not null default 0 check (isr_rate between 0 and 1),
  add column isr_withheld_minor bigint not null default 0 check (isr_withheld_minor >= 0);

-- Preserve historical aggregate ISR exactly, including cent rounding.
with bases as (
  select l.id, p.vat_rate, p.isr_rate, p.isr_withheld_minor,
    l.net_minor::numeric as weight,
    sum(l.net_minor::numeric) over (partition by p.id) as base,
    p.id as parent_id
  from sales_order_lines l join sales_orders p on p.id = l.sales_order_id and p.tenant_id = l.tenant_id
), shares as (
  select *, case when base > 0 then floor(isr_withheld_minor * weight / base) else 0 end as share,
    case when base > 0 then mod(isr_withheld_minor * weight, base) else 0 end as remainder
  from bases
), allocated as (
  select *, sum(share) over (partition by parent_id) as assigned,
    row_number() over (partition by parent_id order by remainder desc, id) as rank
  from shares
)
update sales_order_lines l set vat_rate = a.vat_rate, isr_rate = a.isr_rate,
  isr_withheld_minor = (a.share + case when a.base > 0 and a.rank <= a.isr_withheld_minor - a.assigned then 1 else 0 end)::bigint
from allocated a where l.id = a.id;

alter table commercial_document_lines
  add column vat_rate numeric(8,6) not null default 0.16 check (vat_rate between 0 and 1),
  add column vat_exempt boolean not null default false,
  add column isr_rate numeric(8,6) not null default 0 check (isr_rate between 0 and 1),
  add column isr_withheld_minor bigint not null default 0 check (isr_withheld_minor >= 0);

-- Preserve historical aggregate ISR exactly, including cent rounding.
with bases as (
  select l.id, p.vat_rate, p.isr_rate, p.isr_withheld_minor,
    l.net_minor::numeric as weight,
    sum(l.net_minor::numeric) over (partition by p.id) as base,
    p.id as parent_id
  from commercial_document_lines l join commercial_documents p on p.id = l.document_id and p.tenant_id = l.tenant_id
), shares as (
  select *, case when base > 0 then floor(isr_withheld_minor * weight / base) else 0 end as share,
    case when base > 0 then mod(isr_withheld_minor * weight, base) else 0 end as remainder
  from bases
), allocated as (
  select *, sum(share) over (partition by parent_id) as assigned,
    row_number() over (partition by parent_id order by remainder desc, id) as rank
  from shares
)
update commercial_document_lines l set vat_rate = a.vat_rate, isr_rate = a.isr_rate,
  isr_withheld_minor = (a.share + case when a.base > 0 and a.rank <= a.isr_withheld_minor - a.assigned then 1 else 0 end)::bigint
from allocated a where l.id = a.id;

insert into schema_migrations (id) values ('20261015002840_line_item_taxes');
commit;
