-- =========================================================
-- LOVES STORIES — CORRECCIÓN FINAL 2 (incremental sobre tu base ya instalada)
-- (supabase_migration_FINAL_CORREGIDA_2.sql)
-- Pega este archivo COMPLETO en Supabase → SQL Editor → Run.
-- Solo redefine (CREATE OR REPLACE) las mismas 2 funciones de la corrección
-- anterior, nada más. No DROP TABLE, no TRUNCATE, no borra datos.
-- =========================================================

-- ---------------------------------------------------------
-- ERROR 1: close_order ya NO inserta ningún pago. Solo calcula el total
-- definitivo (con las reglas de descuento) y cambia el estado a 'closed'.
-- El dinero real solo entra por "Registrar depósito". Si hay saldo a favor,
-- se conserva (lo calcula la pantalla con lo realmente depositado). Si falta
-- pagar, el pedido igual se cierra con esa deuda — nunca se inventa un pago.
-- ---------------------------------------------------------
create or replace function public.close_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_total numeric(12,2);
begin
  if not public.is_staff() then
    raise exception 'Solo un usuario autorizado puede cerrar pedidos';
  end if;

  select status into v_status from public.orders where id = p_order_id for update;
  if v_status is null then
    raise exception 'Pedido no encontrado';
  end if;
  if v_status = 'closed' then
    raise exception 'Este pedido ya está cerrado — no se puede volver a cerrar. Si necesitas corregirlo, usa "Editar (corregir)" en Ventas.';
  end if;

  v_total := public.calcular_total_pedido(p_order_id);

  update public.orders
    set status = 'closed', closed_at = now(), total_cerrado = v_total, total_original = v_total
    where id = p_order_id;
  insert into public.audit_log (actor, action, details)
  values (auth.uid(), 'pedido_cerrado', jsonb_build_object('order_id', p_order_id, 'total_final', v_total));
end;
$$;

revoke all on function public.close_order(uuid) from public;
grant execute on function public.close_order(uuid) to authenticated;

-- ---------------------------------------------------------
-- ERROR 2: remove_order_item_unit ahora valida contra la cantidad real de
-- la línea (bloqueada con FOR UPDATE) y nunca devuelve más de lo que
-- realmente había. Si piden quitar más de lo que existe, se limita de
-- forma segura a la cantidad real disponible en esa línea — nunca se
-- sobre-devuelve stock ni al inventario ni al catálogo.
-- ---------------------------------------------------------
create or replace function public.remove_order_item_unit(p_order_item_id uuid, p_quantity int default 1)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid; v_product_id uuid; v_price numeric(10,2); v_origin text;
  v_cantidad_actual int; v_cantidad_real int;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad a quitar debe ser mayor a cero';
  end if;

  select order_id, product_id, unit_price, origin, quantity
    into v_order_id, v_product_id, v_price, v_origin, v_cantidad_actual
  from public.order_items where id = p_order_item_id for update;

  if v_order_id is null then
    raise exception 'No se encontró esa línea del pedido';
  end if;

  -- Nunca se quita ni se devuelve más de lo que realmente hay en la línea.
  v_cantidad_real := least(p_quantity, v_cantidad_actual);

  update public.order_items set quantity = quantity - v_cantidad_real where id = p_order_item_id;
  delete from public.order_items where id = p_order_item_id and quantity <= 0;

  update public.products set stock_reserved = greatest(0, stock_reserved - v_cantidad_real), updated_at = now()
  where id = v_product_id;

  if v_origin = 'catalogo' then
    update public.catalog_products
      set stock_available = stock_available + v_cantidad_real
      where product_id = v_product_id;
  end if;

  insert into public.order_item_history (order_id, product_id, quantity_delta, unit_price, origin, performed_by)
  values (v_order_id, v_product_id, -v_cantidad_real, v_price, 'correccion', auth.uid());

  insert into public.inventory_movements (product_id, type, quantity_delta, order_id, performed_by)
  values (v_product_id, 'devolucion', v_cantidad_real, v_order_id, auth.uid());
end;
$$;

revoke all on function public.remove_order_item_unit(uuid, int) from public;
grant execute on function public.remove_order_item_unit(uuid, int) to authenticated;

-- =========================================================
-- FIN — CORRECCIÓN FINAL 2
-- =========================================================
