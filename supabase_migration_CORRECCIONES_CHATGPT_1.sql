-- =========================================================
-- LOVES STORIES — CORRECCIONES CHATGPT 1
-- Migración incremental y segura. NO borra tablas ni historial.
-- Ejecutar UNA sola vez en Supabase SQL Editor antes de publicar el frontend.
-- =========================================================

-- 1) Cada depósito registra cuánto dinero ya fue consumido por ciclos cerrados.
alter table public.payments
  add column if not exists applied_amount numeric(12,2) not null default 0;

-- Los registros históricos creados erróneamente por versiones antiguas al cerrar
-- no deben volver a considerarse dinero disponible.
update public.payments
set applied_amount = greatest(0, amount)
where method in ('cierre_pedido', 'devolucion_sobrante')
  and coalesce(applied_amount, 0) = 0;

-- Backfill: conserva el comportamiento financiero acumulado que tenía el sistema
-- antes de esta columna, distribuyendo el total de pedidos ya cerrados contra los
-- depósitos reales más antiguos de cada cliente. No elimina ningún movimiento.
do $$
declare
  c record;
  p record;
  restante numeric(12,2);
  aplicar numeric(12,2);
begin
  for c in
    select o.customer_id, coalesce(sum(o.total_cerrado), 0)::numeric(12,2) as consumido
    from public.orders o
    where o.status = 'closed' and o.customer_id is not null
    group by o.customer_id
  loop
    restante := c.consumido;
    for p in
      select id, amount, coalesce(applied_amount, 0) as applied_amount
      from public.payments
      where customer_id = c.customer_id
        and method not in ('cierre_pedido', 'devolucion_sobrante')
        and amount > 0
      order by paid_at, id
    loop
      exit when restante <= 0;
      aplicar := least(greatest(0, p.amount - p.applied_amount), restante);
      if aplicar > 0 then
        update public.payments
          set applied_amount = applied_amount + aplicar
          where id = p.id;
        restante := restante - aplicar;
      end if;
    end loop;
  end loop;
end $$;

-- 2) Cerrar un pedido NO inventa pagos. Congela el total y consume solamente
-- dinero real disponible. Si sobra dinero, queda como crédito para el siguiente ciclo.
create or replace function public.close_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_customer_id uuid;
  v_total numeric(12,2);
  v_restante numeric(12,2);
  v_aplicar numeric(12,2);
  p record;
begin
  if not public.is_staff() then
    raise exception 'Solo un usuario autorizado puede cerrar pedidos';
  end if;

  select status, customer_id into v_status, v_customer_id
  from public.orders where id = p_order_id for update;

  if v_status is null then raise exception 'Pedido no encontrado'; end if;
  if v_status = 'closed' then
    raise exception 'Este pedido ya está cerrado';
  end if;

  v_total := public.calcular_total_pedido(p_order_id);

  update public.orders
    set status = 'closed', closed_at = now(), total_cerrado = v_total, total_original = v_total
    where id = p_order_id;

  -- Aplicar depósitos reales al total de este ciclo, sin crear ningún payment.
  if v_customer_id is not null then
    v_restante := v_total;
    for p in
      select id, amount, applied_amount
      from public.payments
      where customer_id = v_customer_id
        and method not in ('cierre_pedido', 'devolucion_sobrante')
        and amount > coalesce(applied_amount, 0)
      order by paid_at, id
      for update
    loop
      exit when v_restante <= 0;
      v_aplicar := least(p.amount - coalesce(p.applied_amount, 0), v_restante);
      update public.payments set applied_amount = applied_amount + v_aplicar where id = p.id;
      v_restante := v_restante - v_aplicar;
    end loop;
  end if;

  insert into public.audit_log (actor, action, details)
  values (auth.uid(), 'pedido_cerrado', jsonb_build_object(
    'order_id', p_order_id,
    'total_final', v_total,
    'saldo_pendiente_al_cerrar', greatest(0, v_restante)
  ));
end;
$$;

revoke all on function public.close_order(uuid) from public;
grant execute on function public.close_order(uuid) to authenticated;

-- 3) Editar manualmente el precio de un producto SOLO dentro de un pedido abierto.
-- No cambia products.price y no altera ventas cerradas.
create or replace function public.update_open_order_product_price(
  p_order_id uuid, p_product_id uuid, p_unit_price numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_old_prices jsonb;
begin
  if not public.is_staff() then raise exception 'Usuario no autorizado'; end if;
  if p_unit_price is null or p_unit_price < 0 then raise exception 'Precio inválido'; end if;

  select status into v_status from public.orders where id = p_order_id for update;
  if v_status not in ('open', 'reopened') then
    raise exception 'Solo se puede editar el precio de un pedido abierto';
  end if;

  select coalesce(jsonb_agg(distinct unit_price), '[]'::jsonb) into v_old_prices
  from public.order_items where order_id = p_order_id and product_id = p_product_id;

  update public.order_items
    set unit_price = p_unit_price
    where order_id = p_order_id and product_id = p_product_id;

  if not found then raise exception 'Producto no encontrado en el pedido'; end if;

  insert into public.audit_log(actor, action, details)
  values (auth.uid(), 'precio_item_pedido_editado', jsonb_build_object(
    'order_id', p_order_id, 'product_id', p_product_id,
    'precios_anteriores', v_old_prices, 'precio_nuevo', p_unit_price
  ));
end;
$$;

revoke all on function public.update_open_order_product_price(uuid, uuid, numeric) from public;
grant execute on function public.update_open_order_product_price(uuid, uuid, numeric) to authenticated;

-- 4) Registrar devolución de saldo a favor sin crear un pago negativo/ficticio.
create or replace function public.refund_customer_credit(p_customer_id uuid, p_amount numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare
  restante numeric(12,2) := p_amount;
  aplicar numeric(12,2);
  p record;
  disponible numeric(12,2);
begin
  if not public.is_staff() then raise exception 'Usuario no autorizado'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Monto inválido'; end if;

  select coalesce(sum(amount - coalesce(applied_amount,0)),0) into disponible
  from public.payments
  where customer_id = p_customer_id
    and method not in ('cierre_pedido','devolucion_sobrante')
    and amount > coalesce(applied_amount,0);

  if disponible < p_amount then raise exception 'El saldo a favor disponible es insuficiente'; end if;

  for p in
    select id, amount, applied_amount from public.payments
    where customer_id = p_customer_id
      and method not in ('cierre_pedido','devolucion_sobrante')
      and amount > coalesce(applied_amount,0)
    order by paid_at, id for update
  loop
    exit when restante <= 0;
    aplicar := least(p.amount - coalesce(p.applied_amount,0), restante);
    update public.payments set applied_amount = applied_amount + aplicar where id = p.id;
    restante := restante - aplicar;
  end loop;

  insert into public.audit_log(actor, action, details)
  values (auth.uid(), 'saldo_favor_devuelto', jsonb_build_object('customer_id', p_customer_id, 'amount', p_amount));
end;
$$;

revoke all on function public.refund_customer_credit(uuid, numeric) from public;
grant execute on function public.refund_customer_credit(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
