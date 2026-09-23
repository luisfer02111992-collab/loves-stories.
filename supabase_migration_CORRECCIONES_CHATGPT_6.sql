-- LOVES STORIES — CORRECCIONES CHATGPT 6
-- Cierre siempre en cero, edición directa de ventas, caja diaria, historial/exportación,
-- gráfico configurable y mensaje WhatsApp configurable. Incremental; no borra historial.

alter table public.app_settings add column if not exists chart_style text not null default 'bar';
alter table public.app_settings add column if not exists overdue_whatsapp_message text not null default 'Hola 😊 Esperamos que estés muy bien. Queríamos comentarte que ya se cumplió el plazo de selección de tu cuenta. Para poder continuar reservando nuevas joyitas, puedes realizar el cierre de tu cuenta o un pago correspondiente. 💕 Muchas gracias por tu preferencia y comprensión.';

-- Cerrar significa liquidar la cuenta: faltante = pago; sobrante = devolución. Siempre queda 0.
create or replace function public.close_order(p_order_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_status text; v_customer uuid; v_total numeric(12,2); v_disponible numeric(14,2); v_diff numeric(14,2); v_return uuid;
begin
  if not public.is_staff() then raise exception 'Usuario no autorizado'; end if;
  select status,customer_id into v_status,v_customer from public.orders where id=p_order_id for update;
  if v_status is null then raise exception 'Pedido no encontrado'; end if;
  if v_status='closed' then raise exception 'Este pedido ya está cerrado'; end if;
  v_total:=public.calcular_total_pedido(p_order_id);
  if v_customer is not null then
    perform public.rebuild_customer_payment_applications(v_customer);
    select coalesce(sum(amount-coalesce(applied_amount,0)),0) into v_disponible
      from public.payments where customer_id=v_customer and method not in ('cierre_pedido','devolucion_sobrante') and amount>0;
    v_diff:=v_total-v_disponible;
    if v_diff>0 then
      insert into public.payments(customer_id,order_id,amount,method,notes,registered_by)
      values(v_customer,p_order_id,v_diff,'cierre_saldo','Pago de saldo registrado al cerrar la cuenta',auth.uid());
    elsif v_diff<0 then
      insert into public.returns(order_id,customer_id,type,total_amount,reason,observation,created_by)
      values(p_order_id,v_customer,'correccion',abs(v_diff),'Saldo a favor devuelto','Devolución automática del sobrante al cerrar',auth.uid()) returning id into v_return;
      insert into public.audit_log(actor,action,details) values(auth.uid(),'saldo_favor_devuelto',jsonb_build_object('customer_id',v_customer,'order_id',p_order_id,'amount',abs(v_diff),'return_id',v_return));
    end if;
  end if;
  update public.orders set status='closed',closed_at=now(),total_cerrado=v_total,total_original=coalesce(total_original,v_total) where id=p_order_id;
  if v_customer is not null then perform public.rebuild_customer_payment_applications(v_customer); end if;
  insert into public.audit_log(actor,action,details) values(auth.uid(),'pedido_cerrado_liquidado',jsonb_build_object('order_id',p_order_id,'total',v_total,'saldo_final',0));
end $$;
revoke all on function public.close_order(uuid) from public; grant execute on function public.close_order(uuid) to authenticated;

-- +/- directo sobre venta cerrada. Ajusta inventario, total y dinero en la misma transacción.
create or replace function public.adjust_closed_sale_item(p_order_id uuid,p_product_id uuid,p_delta int)
returns numeric language plpgsql security definer set search_path=public as $$
declare v_status text; v_customer uuid; v_old numeric(12,2); v_new numeric(12,2); v_stock int; v_price numeric(10,2); v_item record; v_left int; v_take int; v_return uuid;
begin
  if not public.is_staff() then raise exception 'Usuario no autorizado'; end if;
  if p_delta=0 then raise exception 'Cambio inválido'; end if;
  select status,customer_id,coalesce(total_cerrado,0) into v_status,v_customer,v_old from public.orders where id=p_order_id for update;
  if v_status<>'closed' then raise exception 'Solo se editan ventas cerradas'; end if;
  select stock_available,price into v_stock,v_price from public.products where id=p_product_id for update;
  if p_delta>0 then
    if v_stock<p_delta then raise exception 'Stock insuficiente (disponible: %)',v_stock; end if;
    update public.products set stock_reserved=stock_reserved+p_delta,updated_at=now() where id=p_product_id;
    select unit_price into v_price from public.order_items where order_id=p_order_id and product_id=p_product_id order by assigned_at desc limit 1;
    insert into public.order_items(order_id,product_id,quantity,unit_price,origin,assigned_by) values(p_order_id,p_product_id,p_delta,v_price,'correccion',auth.uid());
  else
    v_left:=abs(p_delta);
    for v_item in select id,quantity,unit_price from public.order_items where order_id=p_order_id and product_id=p_product_id order by assigned_at desc for update loop
      exit when v_left<=0; v_take:=least(v_left,v_item.quantity);
      if v_take=v_item.quantity then delete from public.order_items where id=v_item.id; else update public.order_items set quantity=quantity-v_take where id=v_item.id; end if;
      v_left:=v_left-v_take;
    end loop;
    if v_left>0 then raise exception 'No hay suficientes unidades en la venta'; end if;
    update public.products set stock_reserved=greatest(0,stock_reserved-abs(p_delta)),updated_at=now() where id=p_product_id;
  end if;
  insert into public.order_item_history(order_id,product_id,quantity_delta,unit_price,origin,performed_by) values(p_order_id,p_product_id,p_delta,v_price,'correccion',auth.uid());
  insert into public.inventory_movements(product_id,type,quantity_delta,order_id,performed_by,reason) values(p_product_id,'correccion',-p_delta,p_order_id,auth.uid(),'Edición de venta cerrada');
  v_new:=public.calcular_total_pedido(p_order_id);
  update public.orders set total_cerrado=v_new where id=p_order_id;
  if v_customer is not null then
    if v_new>v_old then
      insert into public.payments(customer_id,order_id,amount,method,notes,registered_by) values(v_customer,p_order_id,v_new-v_old,'ajuste_venta','Cobro adicional por edición de venta',auth.uid());
    elsif v_new<v_old then
      insert into public.returns(order_id,customer_id,type,total_amount,reason,observation,created_by) values(p_order_id,v_customer,'correccion',v_old-v_new,'Corrección de venta','Dinero devuelto por disminución de venta',auth.uid()) returning id into v_return;
    end if;
  end if;
  insert into public.audit_log(actor,action,details) values(auth.uid(),'venta_editada_directa',jsonb_build_object('order_id',p_order_id,'product_id',p_product_id,'delta',p_delta,'total_anterior',v_old,'total_nuevo',v_new));
  return v_new;
end $$;
revoke all on function public.adjust_closed_sale_item(uuid,uuid,int) from public; grant execute on function public.adjust_closed_sale_item(uuid,uuid,int) to authenticated;
notify pgrst,'reload schema';
