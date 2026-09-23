-- LOVES STORIES — CORRECCIÓN 18
-- Sella de forma explícita el usuario autenticado que realizó un cierre.
create or replace function public.stamp_order_closer(p_order_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  if not public.is_staff() then raise exception 'Usuario no autorizado'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'El usuario actual no tiene perfil registrado'; end if;
  update public.orders set closed_by=auth.uid() where id=p_order_id and status='closed';
  if not found then raise exception 'Pedido cerrado no encontrado'; end if;
end $$;
revoke all on function public.stamp_order_closer(uuid) from public;
grant execute on function public.stamp_order_closer(uuid) to authenticated;
notify pgrst,'reload schema';
