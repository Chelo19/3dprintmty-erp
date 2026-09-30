alter table public.quotes
  add column deposit_percent integer not null default 0,
  add column payment_notes text,
  add column lead_time_days integer,
  add constraint quotes_payment_terms_check check (payment_terms in ('pue', 'net_15', 'net_30')),
  add constraint quotes_deposit_check check (deposit_percent between 0 and 100),
  add constraint quotes_lead_time_check check (lead_time_days is null or lead_time_days between 1 and 365);

alter table public.sales_orders
  add column payment_terms text,
  add column deposit_percent integer not null default 0,
  add column payment_notes text,
  add constraint sales_orders_payment_terms_check check (payment_terms is null or payment_terms in ('pue', 'net_15', 'net_30')),
  add constraint sales_orders_deposit_check check (deposit_percent between 0 and 100);

insert into public.schema_migrations (id) values ('0024_payment_conditions');
