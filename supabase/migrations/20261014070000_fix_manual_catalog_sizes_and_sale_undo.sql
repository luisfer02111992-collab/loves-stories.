begin;

CREATE OR REPLACE FUNCTION public.assign_manual_catalog_batch(p_order_id uuid, p_items jsonb, p_seller_id uuid DEFAULT NULL::uuid, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v jsonb; pid uuid; qty int; unit_price numeric; talla text;
 disponible int; publicado int; catid uuid; variant text; variants jsonb;
 talla_qty int; itemid uuid;
BEGIN
 IF NOT public.is_staff() THEN RAISE EXCEPTION 'Usuario no autorizado'; END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Lista vacía'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id AND status IN ('open','reopened')) THEN RAISE EXCEPTION 'Pedido no abierto'; END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  pid:=(v->>'product_id')::uuid; qty:=(v->>'quantity')::int;
  unit_price:=(v->>'unit_price')::numeric; talla:=nullif(trim(v->>'ring_size'),'');
  IF pid IS NULL OR qty IS NULL OR qty<1 THEN RAISE EXCEPTION 'Producto o cantidad inválida'; END IF;
  SELECT stock_available INTO disponible FROM public.products WHERE id=pid FOR UPDATE;
  IF NOT FOUND OR disponible<qty THEN RAISE EXCEPTION 'Stock insuficiente'; END IF;
  SELECT coalesce(sum(CASE WHEN variant_type='ring_size' THEN (SELECT coalesce(sum(value::int),0) FROM jsonb_each_text(coalesce(variant_stock,'{}'::jsonb))) ELSE stock_available END),0)::int INTO publicado FROM public.catalog_products WHERE product_id=pid AND active;
  catid:=NULL; variant:=NULL;
  IF EXISTS (
    SELECT 1 FROM public.catalog_products cp
    WHERE cp.product_id=pid AND cp.active AND cp.variant_type='ring_size'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(coalesce(cp.variant_stock,'{}'::jsonb)) s
        WHERE coalesce(s.value::int,0)>0
      )
  ) THEN
   IF talla IS NULL THEN RAISE EXCEPTION 'Debes elegir una talla para este artículo'; END IF;
   SELECT id,variant_type,coalesce(variant_stock,'{}'::jsonb) INTO catid,variant,variants
   FROM public.catalog_products
   WHERE product_id=pid AND active AND variant_type='ring_size'
     AND coalesce((variant_stock->>talla)::int,0)>=qty
   ORDER BY created_at,id LIMIT 1 FOR UPDATE;
   IF catid IS NULL THEN RAISE EXCEPTION 'Talla % no disponible en catálogo',talla; END IF;
  ELSIF publicado>0 AND publicado=disponible THEN
   SELECT id,variant_type,coalesce(variant_stock,'{}'::jsonb) INTO catid,variant,variants
   FROM public.catalog_products WHERE product_id=pid AND active AND stock_available>=qty
   ORDER BY created_at,id LIMIT 1 FOR UPDATE;
   IF catid IS NULL THEN RAISE EXCEPTION 'Unidades insuficientes en catálogo'; END IF;
   IF variant IS NOT NULL THEN RAISE EXCEPTION 'Debes elegir una variante para este artículo'; END IF;
  END IF;
  PERFORM public.assign_product_to_order(p_order_id,pid,qty,'manual',p_seller_id,p_session_id,unit_price,NULL);
  IF catid IS NOT NULL THEN
   SELECT id INTO itemid FROM public.order_items
   WHERE order_id=p_order_id AND product_id=pid AND origin='manual'
    AND catalog_product_id IS NULL ORDER BY assigned_at DESC,id DESC LIMIT 1 FOR UPDATE;
   IF itemid IS NULL THEN RAISE EXCEPTION 'No se encontró la asignación nueva'; END IF;
   UPDATE public.order_items SET catalog_product_id=catid,ring_size=talla WHERE id=itemid;
   IF variant='ring_size' THEN
    talla_qty:=coalesce((variants->>talla)::int,0);
    UPDATE public.catalog_products SET stock_available=LEAST(stock_available, greatest(0,(SELECT coalesce(sum(value::int),0) FROM jsonb_each_text(variants))-qty)),
      variant_stock=jsonb_set(variants,ARRAY[talla],to_jsonb(talla_qty-qty),true) WHERE id=catid;
   ELSE
    UPDATE public.catalog_products SET stock_available=LEAST(stock_available, GREATEST(0, disponible-qty)) WHERE id=catid;
   END IF;
  END IF;
 END LOOP;
END $function$
;

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
$function$
;

commit;
