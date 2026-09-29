begin;

alter table public.quote_lines
  add column uom text;

update public.quote_lines as line
set uom = service.unit
from public.service_offerings as service
where line.service_id = service.id
  and line.line_kind = 'service';

update public.quote_lines as line
set uom = case
  when product.stock_uom = 'G' or line.line_kind = 'filament' then 'g'
  when product.stock_uom = 'EA' then 'pza'
  else lower(product.stock_uom)
end
from public.products as product
where line.product_id = product.id
  and line.uom is null;

update public.quote_lines
set uom = 'pza'
where uom is null;

alter table public.quote_lines
  alter column uom set not null,
  add constraint quote_lines_uom_check check (char_length(btrim(uom)) between 1 and 16);

insert into public.schema_migrations (id) values ('0012_quote_line_uom');

commit;
