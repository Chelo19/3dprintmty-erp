-- Un producto revendido se compra y se vende. No se fabrica.
-- El inventario lo lista junto con los terminados y los filamentos del catálogo.

alter table public.products drop constraint products_type_check;
alter table public.products
  add constraint products_type_check check (product_type in ('component', 'finished_good', 'service', 'resale'));

insert into public.schema_migrations (id) values ('0017_resale_products');
