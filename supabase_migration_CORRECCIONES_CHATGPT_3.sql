-- =========================================================
-- LOVES STORIES — CORRECCIONES CHATGPT 3
-- Incremental y segura. No borra pedidos, pagos ni historial.
-- Ejecutar UNA sola vez.
-- =========================================================

-- 1) Reglas de descuento: aceptar nombres de categoría en singular/plural.
-- Conservamos las reglas viejas como historial, pero solo estas quedan activas.
update public.pricing_rules set active = false where active = true;

insert into public.pricing_rules (category_id, grouping_type, min_quantity, discount_per_unit, active)
select id, 'model', 3, 1, true
from public.categories
where lower(trim(name)) in ('arete','aretes','dije','dijes','pulsera','pulseras','set','sets','collar','collares')
union all
select id, 'model', 6, 2, true
from public.categories
where lower(trim(name)) in ('arete','aretes','dije','dijes','pulsera','pulseras','set','sets','collar','collares')
union all
select id, 'model', 6, 1, true
from public.categories
where lower(trim(name)) in ('anillo','anillos','cadena','cadenas')
union all
select id, 'model', 12, 2, true
from public.categories
where lower(trim(name)) in ('anillo','anillos','cadena','cadenas');

-- 2) Recalcular de forma determinista cuánto de cada depósito real ya fue usado.
-- Regla: dinero consumido = suma de pedidos cerrados + devoluciones reales de
-- saldo a favor registradas en audit_log. Los depósitos nunca se borran.
create or replace function public.rebuild_customer_payment_applications(p_customer_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_consumido numeric(14,2) := 0;
  v_restante numeric(14,2) := 0;
  v_aplicar numeric(14,2) := 0;
  p record;
begin
  select coalesce(sum(coalesce(total_cerrado,0)),0)::numeric(14,2)
    into v_consumido
  from public.orders
  where customer_id = p_customer_id and status = 'closed';

  v_consumido := v_consumido + coalesce((
    select sum(coalesce((details->>'amount')::numeric,0))
    from public.audit_log
    where action = 'saldo_favor_devuelto'
      and details->>'customer_id' = p_customer_id::text
  ),0);

  -- Solo normalizamos pagos reales positivos. Los registros históricos
  -- cierre_pedido/devolucion_sobrante permanecen excluidos del dinero disponible.
  update public.payments
     set applied_amount = 0
   where customer_id = p_customer_id
     and method not in ('cierre_pedido','devolucion_sobrante')
     and amount > 0;

  v_restante := greatest(0, v_consumido);
  for p in
    select id, amount
    from public.payments
    where customer_id = p_customer_id
      and method not in ('cierre_pedido','devolucion_sobrante')
      and amount > 0
    order by paid_at, id
    for update
  loop
    exit when v_restante <= 0;
    v_aplicar := least(p.amount, v_restante);
    update public.payments set applied_amount = v_aplicar where id = p.id;
    v_restante := v_restante - v_aplicar;
  end loop;

  -- Los pagos ficticios históricos nunca son crédito disponible.
  update public.payments
     set applied_amount = greatest(0, amount)
   where customer_id = p_customer_id
     and method in ('cierre_pedido','devolucion_sobrante');
end;
$$;

revoke all on function public.rebuild_customer_payment_applications(uuid) from public;
grant execute on function public.rebuild_customer_payment_applications(uuid) to authenticated;

-- 3) Cierre: congela el total y luego reconstruye aplicaciones desde la historia
-- completa del cliente. Así no puede consumir Bs 291 si el pedido cerrado fue Bs 204.
create or replace function public.close_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_customer_id uuid;
  v_total numeric(12,2);
  v_disponible_antes numeric(14,2);
  v_disponible_despues numeric(14,2);
begin
  if not public.is_staff() then raise exception 'Solo un usuario autorizado puede cerrar pedidos'; end if;

  select status, customer_id into v_status, v_customer_id
  from public.orders where id = p_order_id for update;

  if v_status is null then raise exception 'Pedido no encontrado'; end if;
  if v_status = 'closed' then raise exception 'Este pedido ya está cerrado'; end if;
  if v_status not in ('open','reopened') then raise exception 'El pedido no está abierto'; end if;

  v_total := public.calcular_total_pedido(p_order_id);

  if v_customer_id is not null then
    -- Normaliza primero cualquier inconsistencia histórica previa.
    perform public.rebuild_customer_payment_applications(v_customer_id);
    select coalesce(sum(amount - coalesce(applied_amount,0)),0)
      into v_disponible_antes
    from public.payments
    where customer_id = v_customer_id
      and method not in ('cierre_pedido','devolucion_sobrante') and amount > 0;
  else
    v_disponible_antes := 0;
  end if;

  update public.orders
     set status = 'closed', closed_at = now(), total_cerrado = v_total, total_original = v_total
   where id = p_order_id;

  if v_customer_id is not null then
    perform public.rebuild_customer_payment_applications(v_customer_id);
    select coalesce(sum(amount - coalesce(applied_amount,0)),0)
      into v_disponible_despues
    from public.payments
    where customer_id = v_customer_id
      and method not in ('cierre_pedido','devolucion_sobrante') and amount > 0;
  else
    v_disponible_despues := 0;
  end if;

  insert into public.audit_log(actor, action, details)
  values (auth.uid(), 'pedido_cerrado', jsonb_build_object(
    'order_id', p_order_id,
    'total_final', v_total,
    'disponible_antes', v_disponible_antes,
    'disponible_despues', v_disponible_despues
  ));
end;
$$;

revoke all on function public.close_order(uuid) from public;
grant execute on function public.close_order(uuid) to authenticated;

-- 4) Reparar ahora mismo los saldos de clientes existentes con la misma regla.
do $$
declare c record;
begin
  for c in select id from public.customers where deleted_at is null loop
    perform public.rebuild_customer_payment_applications(c.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
