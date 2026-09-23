-- =========================================================
-- LOVES STORIES — CORRECCIONES CHATGPT 5
-- SOLO: descuentos + pedidos del catálogo.
-- Incremental. No borra clientes, ventas, pagos ni historial.
-- Ejecutar UNA sola vez después de CHATGPT_4.
-- =========================================================

-- 1) Descuentos. Raíces para singular/plural y description como respaldo.
create or replace function public.calcular_total_pedido(p_order_id uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_total numeric(12,2) := 0;
begin
  select coalesce(sum(greatest(0, g.precio_base -
    case
      when g.grupo_a and g.cantidad >= 6 then 2
      when g.grupo_a and g.cantidad >= 3 then 1
      when g.grupo_b and g.cantidad >= 12 then 2
      when g.grupo_b and g.cantidad >= 6 then 1
      else 0
    end
  ) * g.cantidad),0) into v_total
  from (
    select oi.product_id,
      sum(oi.quantity)::numeric as cantidad,
      (sum(oi.quantity * oi.unit_price) / nullif(sum(oi.quantity),0))::numeric as precio_base,
      (lower(coalesce(c.name,'') || ' ' || coalesce(p.name,'') || ' ' || coalesce(p.description,'')) ~ '(aret|dije|pulser|(^|[^a-z])set([^a-z]|$)|collar)') as grupo_a,
      (lower(coalesce(c.name,'') || ' ' || coalesce(p.name,'') || ' ' || coalesce(p.description,'')) ~ '(anill|caden)') as grupo_b
    from public.order_items oi
    join public.products p on p.id=oi.product_id
    left join public.categories c on c.id=p.category_id
    where oi.order_id=p_order_id
    group by oi.product_id,c.name,p.name,p.description
  ) g;
  return round(v_total,2);
end;
$$;

-- 2) Confirmar pedido público: crea PENDIENTE y descuenta disponibilidad
-- del catálogo EN ESE MOMENTO. No depende de WhatsApp.
create or replace function public.submit_catalog_order(
  p_code text, p_customer_name text, p_customer_phone text,
  p_session_id text, p_items jsonb
) returns text
language plpgsql security definer set search_path=public as $$
declare
  v_submission uuid; v_item jsonb; v_cp uuid; v_qty int;
  v_stock int; v_reserved int;
begin
  if nullif(trim(p_customer_name),'') is null or nullif(trim(p_customer_phone),'') is null then
    raise exception 'Nombre y teléfono son obligatorios';
  end if;
  if p_items is null or jsonb_array_length(p_items)=0 then
    raise exception 'El pedido no tiene productos';
  end if;

  insert into public.catalog_submissions(code,customer_name,customer_phone,session_id,status)
  values(p_code,trim(p_customer_name),trim(p_customer_phone),p_session_id,'pending')
  returning id into v_submission;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cp := (v_item->>'catalog_product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Cantidad inválida'; end if;

    select stock_available into v_stock
    from public.catalog_products where id=v_cp and active=true for update;
    if v_stock is null then raise exception 'Producto de catálogo no disponible'; end if;

    select coalesce(quantity,0) into v_reserved
    from public.catalog_reservations
    where catalog_product_id=v_cp and session_id=p_session_id and expires_at > now()
    order by created_at desc limit 1;
    v_reserved := coalesce(v_reserved,0);

    if v_reserved < v_qty then
      raise exception 'La reserva venció o no cubre la cantidad solicitada';
    end if;
    if v_stock < v_qty then raise exception 'Stock insuficiente'; end if;

    update public.catalog_products
      set stock_available = stock_available - v_qty
      where id=v_cp;

    insert into public.catalog_submission_items(submission_id,catalog_product_id,quantity)
    values(v_submission,v_cp,v_qty);

    delete from public.catalog_reservations
      where catalog_product_id=v_cp and session_id=p_session_id;
  end loop;

  return p_code;
end;
$$;
revoke all on function public.submit_catalog_order(text,text,text,text,jsonb) from public;
grant execute on function public.submit_catalog_order(text,text,text,text,jsonb) to anon, authenticated;

-- 3) Aceptar: el catálogo YA fue descontado al confirmar el pedido público.
-- Aquí solo se pasa al inventario/pedido del cliente. No descontar catálogo dos veces.
create or replace function public.accept_catalog_submission(
  p_submission_id uuid, p_customer_id uuid, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid; v_item jsonb;
  v_catalog_product_id uuid; v_quantity int; v_original int; v_product_id uuid;
begin
  if not exists(select 1 from public.catalog_submissions where id=p_submission_id and status='pending' for update) then
    raise exception 'El pedido ya fue procesado o no existe';
  end if;

  select id into v_order_id from public.orders
  where customer_id=p_customer_id and status in ('open','reopened')
  order by opened_at desc limit 1;
  if v_order_id is null then
    insert into public.orders(customer_id) values(p_customer_id) returning id into v_order_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_catalog_product_id := (v_item->>'catalog_product_id')::uuid;
    v_quantity := greatest(0,(v_item->>'quantity')::int);
    select quantity into v_original from public.catalog_submission_items
      where submission_id=p_submission_id and catalog_product_id=v_catalog_product_id;
    if v_original is null then raise exception 'Item no pertenece al pedido'; end if;
    if v_quantity > v_original then raise exception 'No se puede aceptar más de lo pedido'; end if;

    -- Lo que el administrador decide NO aceptar vuelve a disponibilidad del catálogo.
    if v_original > v_quantity then
      update public.catalog_products set stock_available=stock_available+(v_original-v_quantity)
      where id=v_catalog_product_id;
    end if;

    if v_quantity > 0 then
      select product_id into v_product_id from public.catalog_products where id=v_catalog_product_id;
      if v_product_id is not null then
        perform public.assign_product_to_order(v_order_id,v_product_id,v_quantity,'catalogo');
      end if;
    end if;
  end loop;

  update public.catalog_submissions set status='attached',order_id=v_order_id where id=p_submission_id;
  return v_order_id;
end;
$$;
revoke all on function public.accept_catalog_submission(uuid,uuid,jsonb) from public;
grant execute on function public.accept_catalog_submission(uuid,uuid,jsonb) to authenticated;

-- 4) Rechazar: devuelve al catálogo todo lo que se descontó al enviar el pedido.
create or replace function public.discard_catalog_submission(p_submission_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r record;
begin
  if not exists(select 1 from public.catalog_submissions where id=p_submission_id and status='pending' for update) then
    raise exception 'El pedido ya fue procesado o no existe';
  end if;
  for r in select catalog_product_id,quantity from public.catalog_submission_items where submission_id=p_submission_id loop
    update public.catalog_products set stock_available=stock_available+r.quantity where id=r.catalog_product_id;
  end loop;
  update public.catalog_submissions set status='discarded' where id=p_submission_id;
end;
$$;
revoke all on function public.discard_catalog_submission(uuid) from public;
grant execute on function public.discard_catalog_submission(uuid) to authenticated;

notify pgrst, 'reload schema';
