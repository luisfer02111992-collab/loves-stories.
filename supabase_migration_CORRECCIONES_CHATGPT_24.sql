-- LOVES STORIES — CORRECCIÓN 24
-- Mantiene el catálogo sincronizado cuando un producto sale del inventario activo.
-- No borra ventas ni historial de pedidos.

begin;

-- Limpia ahora mismo publicaciones cuyo producto maestro ya fue eliminado lógicamente.
delete from public.catalog_products cp
where cp.product_id is null
   or not exists (
     select 1 from public.products p
     where p.id = cp.product_id and p.deleted_at is null
   );

-- Si en el futuro un producto se elimina lógicamente del inventario,
-- también se retira automáticamente del catálogo.
create or replace function public.remove_deleted_product_from_catalog()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.catalog_products where product_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_remove_deleted_product_from_catalog on public.products;
create trigger trg_remove_deleted_product_from_catalog
after update of deleted_at on public.products
for each row execute function public.remove_deleted_product_from_catalog();

commit;
