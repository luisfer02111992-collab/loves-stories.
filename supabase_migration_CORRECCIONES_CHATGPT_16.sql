-- LOVES STORIES — CORRECCIÓN 16
-- Guarda quién realizó el cierre para mostrarlo fielmente en el ticket térmico.
-- Incremental. Ejecutar UNA sola vez después de las migraciones anteriores.

alter table public.orders
  add column if not exists closed_by uuid references public.profiles(id);

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
  update public.orders
     set status='closed', closed_at=now(), closed_by=auth.uid(), total_cerrado=v_total,
         total_original=coalesce(total_original,v_total)
   where id=p_order_id;
  if v_customer is not null then perform public.rebuild_customer_payment_applications(v_customer); end if;
  insert into public.audit_log(actor,action,details) values(auth.uid(),'pedido_cerrado_liquidado',jsonb_build_object('order_id',p_order_id,'total',v_total,'saldo_final',0));
end $$;
revoke all on function public.close_order(uuid) from public;
grant execute on function public.close_order(uuid) to authenticated;

notify pgrst,'reload schema';
