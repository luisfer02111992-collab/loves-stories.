-- LOVES STORIES — CORRECCIÓN 20
-- Eliminar una venta cerrada = deshacer el cierre, sin inventar devoluciones de dinero.
-- Cuenta de cliente: vuelve al punto exacto anterior a Cerrar pedido (items + depósitos previos).
-- Venta directa: se anula y devuelve sus productos al inventario.
-- Incremental. No borra ventas históricas físicamente: deja auditoría.

create or replace function public.undo_closed_sale(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_customer uuid;
  v_direct boolean := false;
  v_item record;
  v_auto_return_ids uuid[];
begin
  if not public.is_staff() then
    raise exception 'Usuario no autorizado';
  end if;

  select status, customer_id, coalesce(direct_sale,false)
    into v_status, v_customer, v_direct
  from public.orders
  where id = p_order_id
  for update;

  if v_status is null then raise exception 'Venta no encontrada'; end if;
  if v_status <> 'closed' then raise exception 'Solo se puede eliminar una venta cerrada'; end if;

  if v_direct or v_customer is null then
    -- Venta directa: el pago pertenece a esta venta y debe desaparecer del cálculo.
    delete from public.payments where order_id = p_order_id;

    -- Libera todas las unidades que estaban reservadas por esta venta.
    for v_item in
      select product_id, sum(quantity)::int as qty
      from public.order_items
      where order_id = p_order_id
      group by product_id
    loop
      update public.products
         set stock_reserved = greatest(0, stock_reserved - v_item.qty), updated_at = now()
       where id = v_item.product_id;

      insert into public.inventory_movements(product_id,type,quantity_delta,order_id,performed_by,reason)
      values(v_item.product_id,'cancelacion',v_item.qty,p_order_id,auth.uid(),'Venta directa eliminada: stock liberado');
    end loop;

    update public.orders
       set status='cancelled', closed_at=null, closed_by=null, total_cerrado=null
     where id=p_order_id;

    insert into public.audit_log(actor,action,details)
    values(auth.uid(),'venta_directa_eliminada',jsonb_build_object('order_id',p_order_id,'stock_liberado',true,'dinero_contabilizado',0));
  else
    -- Cuenta registrada: conservar depósitos/amortizaciones que existían antes del cierre.
    -- Solo se elimina el pago artificial creado por la acción de cerrar.
    delete from public.payments
     where order_id=p_order_id
       and method in ('cierre_saldo','cierre_pedido');

    -- Si el cierre generó automáticamente un "sobrante devuelto", también se revierte,
    -- porque queremos regresar exactamente al instante anterior al cierre.
    select coalesce(array_agg(id),array[]::uuid[])
      into v_auto_return_ids
    from public.returns
    where order_id=p_order_id
      and type='correccion'
      and reason='Saldo a favor devuelto';

    if cardinality(v_auto_return_ids) > 0 then
      delete from public.return_items where return_id = any(v_auto_return_ids);
      delete from public.returns where id = any(v_auto_return_ids);
    end if;

    delete from public.audit_log
     where action='saldo_favor_devuelto'
       and details->>'order_id'=p_order_id::text;

    -- Los productos NO se liberan: antes del cierre ya estaban asignados al cliente.
    -- La cuenta vuelve a abierta/reabierta con exactamente esos items.
    update public.orders
       set status='reopened', closed_at=null, closed_by=null, total_cerrado=null
     where id=p_order_id;

    perform public.rebuild_customer_payment_applications(v_customer);

    insert into public.audit_log(actor,action,details)
    values(auth.uid(),'venta_eliminada_cierre_revertido',jsonb_build_object(
      'order_id',p_order_id,
      'customer_id',v_customer,
      'estado_restaurado','reopened',
      'depositos_previos_conservados',true,
      'items_asignados_conservados',true,
      'dinero_de_venta_contabilizado',0
    ));
  end if;
end;
$$;

revoke all on function public.undo_closed_sale(uuid) from public;
grant execute on function public.undo_closed_sale(uuid) to authenticated;

notify pgrst,'reload schema';
