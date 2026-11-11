create function public.sync_catalog_product_price()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update public.catalog_products
  set price = new.price
  where product_id = new.id
    and active
    and price is distinct from new.price;

  return new;
end;
$function$;

revoke execute on function public.sync_catalog_product_price() from public, anon, authenticated;

create trigger trg_sync_catalog_product_price
after update of price on public.products
for each row
when (old.price is distinct from new.price and new.deleted_at is null)
execute function public.sync_catalog_product_price();

update public.catalog_products as catalog
set price = product.price
from public.products as product
where catalog.product_id = product.id
  and catalog.active
  and product.deleted_at is null
  and catalog.price is distinct from product.price;
