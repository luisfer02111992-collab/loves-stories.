-- =========================================================
-- LOVES STORIES — CORRECCIONES CHATGPT 2
-- Incremental. No borra pedidos, pagos, productos ni historial.
-- Ejecutar UNA sola vez.
-- =========================================================

-- 1) Regla exacta de descuentos indicada por el negocio.
-- Desactivamos las reglas anteriores para evitar duplicados/ambigüedad y
-- creamos un único juego vigente. Los registros viejos quedan como historial.
update public.pricing_rules set active = false where active = true;

insert into public.pricing_rules (category_id, grouping_type, min_quantity, discount_per_unit, active)
select id, 'model', 3, 1, true from public.categories where lower(name) in ('aretes','dijes','pulseras','sets','collares')
union all
select id, 'model', 6, 2, true from public.categories where lower(name) in ('aretes','dijes','pulseras','sets','collares')
union all
select id, 'model', 6, 1, true from public.categories where lower(name) in ('anillos','cadenas')
union all
select id, 'model', 12, 2, true from public.categories where lower(name) in ('anillos','cadenas');

-- 2) Quitar unidades de un pedido sin violar el CHECK quantity > 0.
-- Si se quita toda la línea, se elimina directamente; si no, solo se reduce.
create or replace function public.remove_order_item_unit(p_order_item_id uuid, p_quantity int default 1)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid; v_product_id uuid; v_price numeric(10,2); v_origin text;
  v_cantidad_actual int; v_cantidad_real int; v_status text;
begin
  if not public.is_staff() then raise exception 'Usuario no autorizado'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'La cantidad a quitar debe ser mayor a cero'; end if;

  select oi.order_id, oi.product_id, oi.unit_price, oi.origin, oi.quantity, o.status
    into v_order_id, v_product_id, v_price, v_origin, v_cantidad_actual, v_status
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = p_order_item_id
  for update of oi;

  if v_order_id is null then raise exception 'No se encontró esa línea del pedido'; end if;
  if v_status not in ('open','reopened') then raise exception 'Solo se puede modificar un pedido abierto'; end if;

  v_cantidad_real := least(p_quantity, v_cantidad_actual);

  if v_cantidad_real >= v_cantidad_actual then
    delete from public.order_items where id = p_order_item_id;
  else
    update public.order_items set quantity = quantity - v_cantidad_real where id = p_order_item_id;
  end if;

  update public.products
    set stock_reserved = greatest(0, stock_reserved - v_cantidad_real), updated_at = now()
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

-- 3) Total del servidor con la misma regla: cantidad acumulada DEL MISMO PRODUCTO.
create or replace function public.calcular_total_pedido(p_order_id uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_total numeric(12,2) := 0;
begin
  select coalesce(sum(
    greatest(0, (g.subtotal / nullif(g.cantidad,0)) - coalesce((
      select pr.discount_per_unit
      from public.pricing_rules pr
      where pr.active
        and pr.category_id = g.category_id
        and pr.min_quantity <= g.cantidad
      order by pr.min_quantity desc, pr.discount_per_unit desc
      limit 1
    ), 0)) * g.cantidad
  ), 0) into v_total
  from (
    select oi.product_id, p.category_id, sum(oi.quantity)::numeric as cantidad,
           sum(oi.quantity * oi.unit_price)::numeric as subtotal
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
    group by oi.product_id, p.category_id
  ) g;
  return round(v_total, 2);
end;
$$;

revoke all on function public.calcular_total_pedido(uuid) from public;
grant execute on function public.calcular_total_pedido(uuid) to authenticated;

notify pgrst, 'reload schema';
