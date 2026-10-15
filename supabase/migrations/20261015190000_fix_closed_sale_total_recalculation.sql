-- Recalculate closed-sale totals from the saved order item prices.
-- The regular calculator intentionally returns the cached total for closed orders;
-- corrections need an item-derived total, otherwise the old total is written back.

create or replace function public.calcular_total_items_pedido(p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with grouped as (
    select
      oi.product_id,
      p.category_id,
      max(p.name) as name,
      sum(oi.quantity)::numeric as quantity,
      sum(oi.quantity * oi.unit_price) / nullif(sum(oi.quantity), 0) as base_price
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
    group by oi.product_id, p.category_id
  ),
  priced as (
    select
      quantity,
      greatest(
        0,
        base_price - case
          when lower(coalesce(name, '')) ~ '(aret|dije|pulser|(^|[^a-z])set([^a-z]|$)|collar)'
            then case when quantity >= 6 then 2 when quantity >= 3 then 1 else 0 end
          when lower(coalesce(name, '')) ~ '(anill|caden)'
            then case when quantity >= 12 then 2 when quantity >= 6 then 1 else 0 end
          else coalesce((
            select pr.discount_per_unit
            from public.pricing_rules pr
            where pr.active
              and (pr.category_id = grouped.category_id or pr.category_id is null)
              and pr.min_quantity <= grouped.quantity
            order by pr.min_quantity desc
            limit 1
          ), 0)
        end
      ) as final_unit_price
    from grouped
  )
  select round(coalesce(sum(quantity * final_unit_price), 0), 2)
  from priced;
$$;

revoke all on function public.calcular_total_items_pedido(uuid) from public;

create or replace function public.save_closed_sale_corrections(p_order_id uuid, p_changes jsonb)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_change jsonb;
  v_product uuid;
  v_delta int;
  v_stock int;
  v_price numeric(12,2);
  v_left int;
  v_take int;
  v_item record;
  v_total numeric(12,2);
begin
  if not public.is_staff() then
    raise exception 'Usuario no autorizado';
  end if;

  select status into v_status
  from public.orders
  where id = p_order_id
  for update;

  if v_status is null then
    raise exception 'Pedido no encontrado';
  end if;
  if v_status <> 'closed' then
    raise exception 'Solo se pueden corregir ventas cerradas';
  end if;
  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Cambios inválidos';
  end if;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_product := (v_change->>'product_id')::uuid;
    v_delta := coalesce((v_change->>'delta')::int, 0);
    if v_delta = 0 then
      continue;
    end if;

    select stock_available, price
    into v_stock, v_price
    from public.products
    where id = v_product and deleted_at is null
    for update;

    if not found then
      raise exception 'Producto no encontrado';
    end if;

    if v_delta > 0 then
      if v_stock < v_delta then
        raise exception 'Stock insuficiente. Disponible: %', v_stock;
      end if;

      select unit_price into v_price
      from public.order_items
      where order_id = p_order_id and product_id = v_product
      order by assigned_at desc
      limit 1;

      if v_price is null then
        select price into v_price from public.products where id = v_product;
      end if;

      update public.products
      set stock_reserved = stock_reserved + v_delta, updated_at = now()
      where id = v_product;

      insert into public.order_items(order_id, product_id, quantity, unit_price, origin, assigned_by)
      values (p_order_id, v_product, v_delta, v_price, 'correccion', auth.uid());
    else
      v_left := abs(v_delta);

      for v_item in
        select id, quantity, unit_price
        from public.order_items
        where order_id = p_order_id and product_id = v_product
        order by assigned_at desc
        for update
      loop
        exit when v_left <= 0;
        v_take := least(v_left, v_item.quantity);
        v_price := v_item.unit_price;

        if v_take = v_item.quantity then
          delete from public.order_items where id = v_item.id;
        else
          update public.order_items set quantity = quantity - v_take where id = v_item.id;
        end if;

        v_left := v_left - v_take;
      end loop;

      if v_left > 0 then
        raise exception 'No hay suficientes unidades de ese producto en la venta';
      end if;

      update public.products
      set stock_reserved = greatest(0, stock_reserved - abs(v_delta)), updated_at = now()
      where id = v_product;
    end if;

    insert into public.order_item_history(order_id, product_id, quantity_delta, unit_price, origin, performed_by)
    values (p_order_id, v_product, v_delta, v_price, 'correccion', auth.uid());

    insert into public.inventory_movements(product_id, type, quantity_delta, order_id, performed_by, reason)
    values (v_product, 'correccion', -v_delta, p_order_id, auth.uid(), 'Corrección de venta cerrada sin movimiento de dinero');
  end loop;

  -- Use persisted sale prices and current quantity discounts. Do not call
  -- calcular_total_pedido here: it deliberately returns total_cerrado for closed orders.
  v_total := public.calcular_total_items_pedido(p_order_id);

  update public.orders
  set total_cerrado = v_total
  where id = p_order_id;

  insert into public.audit_log(actor, action, details)
  values (
    auth.uid(),
    'venta_corregida_sin_dinero',
    jsonb_build_object('order_id', p_order_id, 'changes', p_changes, 'total_nuevo', v_total)
  );

  return v_total;
end;
$$;

revoke all on function public.save_closed_sale_corrections(uuid, jsonb) from public;
grant execute on function public.save_closed_sale_corrections(uuid, jsonb) to authenticated;
