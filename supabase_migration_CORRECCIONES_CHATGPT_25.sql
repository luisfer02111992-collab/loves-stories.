-- LOVES STORIES — CORRECCIÓN 25
-- Corrige el catálogo sin romper pedidos históricos.
-- IMPORTANTE: no elimina catalog_products referenciados por catalog_submission_items.

begin;

-- Retira del catálogo visible cualquier publicación cuyo producto maestro
-- ya no exista o haya sido eliminado del inventario activo.
update public.catalog_products cp
set active = false,
    stock_available = 0
where cp.product_id is null
   or not exists (
     select 1
     from public.products p
     where p.id = cp.product_id
       and p.deleted_at is null
   );

-- Cuando un producto maestro se elimina lógicamente, su publicación se
-- desactiva en vez de borrarse. Así conservamos la integridad de los
-- pedidos históricos que puedan referenciar catalog_products.
create or replace function public.remove_deleted_product_from_catalog()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.catalog_products
       set active = false, stock_available = 0
     where product_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_remove_deleted_product_from_catalog on public.products;
create trigger trg_remove_deleted_product_from_catalog
after update of deleted_at on public.products
for each row execute function public.remove_deleted_product_from_catalog();

commit;
