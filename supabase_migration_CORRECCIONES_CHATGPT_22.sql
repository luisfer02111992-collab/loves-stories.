-- LOVES STORIES — CORRECCIÓN 22
-- Eliminación DEFINITIVA de clientes.
-- A diferencia del borrado lógico anterior, este proceso elimina físicamente
-- al cliente y sus datos operativos relacionados.
-- Los artículos de pedidos todavía abiertos/reabiertos se liberan del stock reservado.
-- Las ventas ya cerradas se eliminan del historial financiero, pero NO se reponen al stock:
-- fueron operaciones cerradas y la eliminación del cliente no debe crear inventario ficticio.

create or replace function public.delete_customer_completely(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
  v_order_ids uuid[];
  v_item record;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar clientes definitivamente';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;

  if v_customer.id is null then
    raise exception 'Cliente no encontrado';
  end if;

  -- Primero liberar únicamente lo que seguía reservado en pedidos abiertos.
  for v_item in
    select oi.product_id, sum(oi.quantity)::int as qty
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.customer_id = p_customer_id
      and o.status in ('open','reopened')
    group by oi.product_id
  loop
    update public.products
       set stock_reserved = greatest(0, coalesce(stock_reserved,0) - v_item.qty),
           updated_at = now()
     where id = v_item.product_id;
  end loop;

  select coalesce(array_agg(id), array[]::uuid[])
    into v_order_ids
  from public.orders
  where customer_id = p_customer_id;

  -- Eliminar dependencias de los pedidos antes de eliminar los pedidos.
  if cardinality(v_order_ids) > 0 then
    delete from public.return_items
     where return_id in (select id from public.returns where order_id = any(v_order_ids));
    delete from public.returns where order_id = any(v_order_ids);
    delete from public.payments where order_id = any(v_order_ids) or customer_id = p_customer_id;
    delete from public.pdf_versions where order_id = any(v_order_ids);
    delete from public.inventory_movements where order_id = any(v_order_ids);
    delete from public.order_item_history where order_id = any(v_order_ids);
    delete from public.order_items where order_id = any(v_order_ids);
    delete from public.orders where id = any(v_order_ids);
  else
    delete from public.payments where customer_id = p_customer_id;
    delete from public.returns where customer_id = p_customer_id;
  end if;

  -- Quitar auditoría ligada directamente al cliente para que no quede como cliente inactivo/restaurable.
  delete from public.audit_log
   where details->>'customer_id' = p_customer_id::text;

  delete from public.customers where id = p_customer_id;
end;
$$;

revoke all on function public.delete_customer_completely(uuid) from public;
grant execute on function public.delete_customer_completely(uuid) to authenticated;

notify pgrst,'reload schema';
