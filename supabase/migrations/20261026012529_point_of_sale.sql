begin;
alter table public.sales_orders
  add column sales_channel text not null default 'order',
  add column cash_tendered_minor bigint,
  add constraint sales_orders_channel_check check (sales_channel in ('order', 'pos')),
  add constraint sales_orders_cash_tendered_check check (cash_tendered_minor is null or (sales_channel = 'pos' and cash_tendered_minor >= total_minor));
create index sales_orders_pos_created_idx on public.sales_orders (tenant_id, created_at desc, id desc)
  where sales_channel = 'pos';
insert into public.schema_migrations(id) values ('20261026012529_point_of_sale');
commit;
