begin;
-- Cancelación lógica: se conservan importes, fechas de pago y autores originales.
alter table public.expenses
  add column canceled_at timestamptz,
  add column canceled_by uuid references public.user_accounts(id),
  add column cancellation_reason text,
  add constraint expenses_cancellation_check check (
    (canceled_at is null and canceled_by is null and cancellation_reason is null) or
    (canceled_at is not null and canceled_by is not null and cancellation_reason is not null and length(trim(cancellation_reason)) between 3 and 240));
alter table public.expense_payments
  add column canceled_at timestamptz,
  add column canceled_by uuid references public.user_accounts(id),
  add column cancellation_reason text,
  add constraint expense_payments_cancellation_check check (
    (canceled_at is null and canceled_by is null and cancellation_reason is null) or
    (canceled_at is not null and canceled_by is not null and cancellation_reason is not null and length(trim(cancellation_reason)) between 3 and 240));
insert into public.schema_migrations(id) values ('20261027233946_cancel_expenses_and_payments');
commit;
