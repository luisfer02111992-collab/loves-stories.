-- Prevent undoing a closed customer sale when another active folder exists.
-- This avoids creating two simultaneous folders for one customer.

CREATE OR REPLACE FUNCTION public.undo_closed_sale(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_customer uuid;
  v_direct boolean := false;
  v_item record;
  v_variant_qty integer;
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

  -- Evitar dos carpetas activas para la misma clienta. Si se asignaron productos
  -- en una nueva carpeta después del cierre, primero debe resolverse esa carpeta.
  if not v_direct and v_customer is not null and exists (
    select 1
    from public.orders o
    where o.customer_id = v_customer
      and o.id <> p_order_id
      and o.status in ('open', 'reopened')
  ) then
    raise exception 'No se puede eliminar el cierre: esta clienta ya tiene otra carpeta abierta. Resuelve esa carpeta antes de eliminar la venta.';
  end if;

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
      -- El cierre ya descontó el físico y liberó esta reserva.
      -- Al cancelar la venta se devuelve el físico sin tocar reservas de otros pedidos.
      update public.products
         set stock_physical = stock_physical + v_item.qty, updated_at = now()
       where id = v_item.product_id;

      insert into public.inventory_movements(product_id,type,quantity_delta,order_id,performed_by,reason)
      values(v_item.product_id,'devolucion',v_item.qty,p_order_id,auth.uid(),'Venta directa eliminada: producto devuelto al inventario');
    end loop;

    -- Si la venta directa salió de una publicación, restituir sus unidades
    -- en la misma publicación y talla registrada.
    for v_item in
      select oi.catalog_product_id, oi.ring_size, oi.quantity::int as qty,
             cp.variant_type, coalesce(cp.variant_stock,'{}'::jsonb) as variant_stock
      from public.order_items oi
      join public.catalog_products cp on cp.id = oi.catalog_product_id
      where oi.order_id = p_order_id
      for update of cp
    loop
      if v_item.variant_type = 'ring_size' then
        if v_item.ring_size is null then
          raise exception 'No se registró la talla original; no se puede devolver la publicación con seguridad';
        end if;
        v_variant_qty := coalesce((v_item.variant_stock ->> v_item.ring_size)::int,0);
        update public.catalog_products
           set stock_available = stock_available + v_item.qty,
               variant_stock = jsonb_set(
                 v_item.variant_stock,
                 array[v_item.ring_size],
                 to_jsonb(v_variant_qty + v_item.qty),
                 true
               )
         where id = v_item.catalog_product_id;
      else
        update public.catalog_products
           set stock_available = stock_available + v_item.qty
         where id = v_item.catalog_product_id;
      end if;
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

    -- Revertir el descuento del cierre y restaurar la reserva de los ítems
    -- que permanecen asignados a la cuenta reabierta.
    for v_item in
      select product_id, sum(quantity)::int as qty
      from public.order_items
      where order_id = p_order_id
      group by product_id
    loop
      update public.products
         set stock_physical = stock_physical + v_item.qty,
             stock_reserved = stock_reserved + v_item.qty,
             updated_at = now()
       where id = v_item.product_id;

      insert into public.inventory_movements(product_id,type,quantity_delta,order_id,performed_by,reason)
      values(v_item.product_id,'devolucion',v_item.qty,p_order_id,auth.uid(),'Cierre revertido: inventario y reserva restaurados');
    end loop;

    -- La cuenta vuelve a abierta/reabierta con sus ítems todavía asignados.
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
$function$;

revoke all on function public.undo_closed_sale(uuid) from public;
grant execute on function public.undo_closed_sale(uuid) to authenticated;
