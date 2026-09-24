-- LOVES STORIES — CORRECCIÓN 23
-- Eliminación DEFINITIVA de vendedores.
-- Mantiene intactas las ventas: si un registro histórico apuntaba a este vendedor,
-- queda sin vendedor asignado. Las sesiones del vendedor sí se eliminan.

create or replace function public.delete_seller_completely(p_seller_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar vendedores definitivamente';
  end if;

  if not exists (select 1 from public.sellers where id = p_seller_id) then
    raise exception 'Vendedor no encontrado';
  end if;

  -- Quitar primero las referencias para respetar las claves foráneas.
  update public.order_items
     set seller_id = null,
         session_id = null
   where seller_id = p_seller_id
      or session_id in (select id from public.sales_sessions where seller_id = p_seller_id);

  delete from public.sales_sessions where seller_id = p_seller_id;
  delete from public.sellers where id = p_seller_id;
end;
$$;

revoke all on function public.delete_seller_completely(uuid) from public;
grant execute on function public.delete_seller_completely(uuid) to authenticated;

notify pgrst,'reload schema';
