-- La fecha del gasto es el día en que aplica. El pago puede ser parcial y en otra fecha.

alter table public.expenses add column occurred_on date;

update public.expenses
set occurred_on = (created_at at time zone 'America/Mexico_City')::date
where occurred_on is null;

alter table public.expenses alter column occurred_on set not null;

create index expenses_tenant_occurred_idx on public.expenses (tenant_id, occurred_on desc);

create table public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  expense_id uuid not null references public.expenses (id),
  paid_on date not null,
  amount_minor bigint not null,
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint expense_payments_amount_check check (amount_minor > 0)
);

create index expense_payments_tenant_paid_idx on public.expense_payments (tenant_id, paid_on desc);
create index expense_payments_expense_idx on public.expense_payments (expense_id);

select public.apply_tenant_rls('expense_payments', array['owner', 'admin', 'warehouse'], false);

insert into public.expense_payments (tenant_id, expense_id, paid_on, amount_minor, note, created_by)
select tenant_id, id, occurred_on, amount_minor, 'Pago registrado con el gasto', created_by
from public.expenses
where amount_minor > 0;

insert into public.schema_migrations (id) values ('0019_expense_payments');
