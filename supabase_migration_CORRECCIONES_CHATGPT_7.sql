-- LOVES STORIES — CORRECCIONES CHATGPT 7
-- Edición de ventas cerradas sin movimientos de dinero, clientes abiertos/cerrados,
-- depósito reabre cuenta y guardado de correcciones en bloque.
-- INCREMENTAL: ejecutar una sola vez después de CORRECCIONES_CHATGPT_6.sql.

-- Un depósito en un cliente sin cuenta abierta crea automáticamente un nuevo ciclo.
create or replace function public.register_customer_deposit(p_customer_id uuid, p_amount numeric, p_method text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_order uuid;
begin
  if not public.is_staff() then raise exception 'Usuario no autorizado'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  select id into v_order from public.orders where customer_id=p_customer_id and status in ('open','reopened') order by opened_at desc limit 1 for update;
  if v_order is null then
    insert into public.orders(customer_id,status,opened_at) values(p_customer_id,'open',now()) returning id into v_order;
  end if;
  insert into public.payments(customer_id,order_id,amount,method,registered_by)
  values(p_customer_id,v_order,p_amount,coalesce(nullif(p_method,''),'efectivo'),auth.uid());
  insert into public.audit_log(actor,action,details) values(auth.uid(),'deposito_registrado',jsonb_build_object('customer_id',p_customer_id,'order_id',v_order,'amount',p_amount,'method',p_method));
  return v_order;
end $$;
revoke all on function public.register_customer_deposit(uuid,numeric,text) from public;
grant execute on function public.register_customer_deposit(uuid,numeric,text) to authenticated;

-- Guarda TODOS los +/- de una venta cerrada en una sola transacción.
-- Una corrección cambia productos, inventario y total de la venta, pero NUNCA crea
-- pago, reembolso, devolución monetaria ni saldo a favor.
create or replace function public.save_closed_sale_corrections(p_order_id uuid, p_changes jsonb)
returns numeric language plpgsql security definer set search_path=public as $$
declare
  v_status text; v_change jsonb; v_product uuid; v_delta int; v_stock int; v_price numeric(12,2);
  v_left int; v_take int; v_item record; v_total numeric(12,2);
begin
  if not public.is_staff() then raise exception 'Usuario no autorizado'; end if;
  select status into v_status from public.orders where id=p_order_id for update;
  if v_status is null then raise exception 'Pedido no encontrado'; end if;
  if v_status <> 'closed' then raise exception 'Solo se pueden corregir ventas cerradas'; end if;
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'Cambios inválidos'; end if;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_product := (v_change->>'product_id')::uuid;
    v_delta := coalesce((v_change->>'delta')::int,0);
    if v_delta = 0 then continue; end if;
    select stock_available,price into v_stock,v_price from public.products where id=v_product and deleted_at is null for update;
    if not found then raise exception 'Producto no encontrado'; end if;

    if v_delta > 0 then
      if v_stock < v_delta then raise exception 'Stock insuficiente. Disponible: %',v_stock; end if;
      select unit_price into v_price from public.order_items where order_id=p_order_id and product_id=v_product order by assigned_at desc limit 1;
      if v_price is null then select price into v_price from public.products where id=v_product; end if;
      update public.products set stock_reserved=stock_reserved+v_delta,updated_at=now() where id=v_product;
      insert into public.order_items(order_id,product_id,quantity,unit_price,origin,assigned_by)
      values(p_order_id,v_product,v_delta,v_price,'correccion',auth.uid());
    else
      v_left:=abs(v_delta);
      for v_item in select id,quantity,unit_price from public.order_items where order_id=p_order_id and product_id=v_product order by assigned_at desc for update loop
        exit when v_left<=0; v_take:=least(v_left,v_item.quantity); v_price:=v_item.unit_price;
        if v_take=v_item.quantity then delete from public.order_items where id=v_item.id;
        else update public.order_items set quantity=quantity-v_take where id=v_item.id; end if;
        v_left:=v_left-v_take;
      end loop;
      if v_left>0 then raise exception 'No hay suficientes unidades de ese producto en la venta'; end if;
      update public.products set stock_reserved=greatest(0,stock_reserved-abs(v_delta)),updated_at=now() where id=v_product;
    end if;

    insert into public.order_item_history(order_id,product_id,quantity_delta,unit_price,origin,performed_by)
    values(p_order_id,v_product,v_delta,v_price,'correccion',auth.uid());
    insert into public.inventory_movements(product_id,type,quantity_delta,order_id,performed_by,reason)
    values(v_product,'correccion',-v_delta,p_order_id,auth.uid(),'Corrección de venta cerrada sin movimiento de dinero');
  end loop;

  v_total:=public.calcular_total_pedido(p_order_id);
  update public.orders set total_cerrado=v_total where id=p_order_id;
  insert into public.audit_log(actor,action,details) values(auth.uid(),'venta_corregida_sin_dinero',jsonb_build_object('order_id',p_order_id,'changes',p_changes,'total_nuevo',v_total));
  return v_total;
end $$;
revoke all on function public.save_closed_sale_corrections(uuid,jsonb) from public;
grant execute on function public.save_closed_sale_corrections(uuid,jsonb) to authenticated;

-- Compatibilidad: si alguna pantalla antigua aún llama esta función, tampoco mueve dinero.
create or replace function public.adjust_closed_sale_item(p_order_id uuid,p_product_id uuid,p_delta int)
returns numeric language plpgsql security definer set search_path=public as $$
begin
  return public.save_closed_sale_corrections(p_order_id,jsonb_build_array(jsonb_build_object('product_id',p_product_id,'delta',p_delta)));
end $$;
revoke all on function public.adjust_closed_sale_item(uuid,uuid,int) from public;
grant execute on function public.adjust_closed_sale_item(uuid,uuid,int) to authenticated;

notify pgrst,'reload schema';
