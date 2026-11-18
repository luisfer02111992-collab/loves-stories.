-- Vaciar un pedido abierto reutilizando la devolución por origen existente.
create or replace function public.clear_open_order(p_order_id uuid, p_items jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_status text;
  v_actual jsonb;
  v_expected jsonb;
  v_item record;
  v_units integer := 0;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Usuario no autorizado';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay productos para limpiar';
  end if;

  select status into v_status
  from public.orders where id = p_order_id for update;
  if not found or v_status not in ('open', 'reopened') then
    raise exception 'Solo se pueden limpiar pedidos abiertos';
  end if;

  -- El bloqueo del pedido también detiene nuevas asignaciones por la clave foránea.
  perform id from public.order_items where order_id = p_order_id
  order by product_id, id for update;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'quantity', quantity) order by id), '[]'::jsonb)
    into v_actual from public.order_items where order_id = p_order_id;
  if v_actual = '[]'::jsonb then
    return 0;
  end if;

  select jsonb_agg(jsonb_build_object('id', id, 'quantity', quantity) order by id)
    into v_expected from jsonb_to_recordset(p_items) as x(id uuid, quantity integer);
  if v_actual is distinct from v_expected then
    raise exception 'El pedido cambió. Actualiza el cliente y vuelve a confirmar Limpiar todo.';
  end if;

  for v_item in select id, quantity from public.order_items
    where order_id = p_order_id order by product_id, id
  loop
    perform public.remove_order_item_unit(v_item.id, v_item.quantity);
    v_units := v_units + v_item.quantity;
  end loop;
  return v_units;
end;
$function$;

revoke all on function public.clear_open_order(uuid, jsonb) from public, anon;
grant execute on function public.clear_open_order(uuid, jsonb) to authenticated;
