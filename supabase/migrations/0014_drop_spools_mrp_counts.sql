-- Rollos, MRP y conteo cíclico salen del producto. El kardex, los lotes,
-- las compras y la producción se quedan.

alter table public.production_consumptions drop column if exists spool_id;
alter table public.production_orders drop column if exists planned_order_id;
alter table public.purchase_orders drop column if exists planned_order_id;

drop table if exists public.spool_events;
drop table if exists public.spools;
drop table if exists public.cycle_count_lines;
drop table if exists public.cycle_counts;
drop table if exists public.mrp_planned_orders;
drop table if exists public.mrp_runs;

insert into public.schema_migrations (id) values ('0014_drop_spools_mrp_counts');
