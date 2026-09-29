begin;

-- El precio de venta del filamento es por gramo. Los importes grandes que se
-- capturaron como precio del kilogramo (el ejemplo era 480.00) se convierten.
update public.products
set sale_price_minor = round(sale_price_minor / uom_factor)::bigint
where product_type = 'raw_material'
  and sale_price_minor is not null
  and sale_price_minor >= 1000
  and uom_factor > 0;

insert into public.schema_migrations (id) values ('0010_filament_sale_per_gram');

commit;
