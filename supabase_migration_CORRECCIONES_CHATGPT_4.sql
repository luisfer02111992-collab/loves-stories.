-- =========================================================
-- LOVES STORIES — CORRECCIONES CHATGPT 4
-- Incremental. No borra clientes, pedidos, pagos ni historial.
-- Ejecutar UNA sola vez después de CORRECCIONES_CHATGPT_3.sql.
-- =========================================================

-- 1) Total/descuentos: misma regla de negocio aunque una ficha antigua tenga
-- category_id vacío/equivocado; se usa categoría y, como respaldo, nombre.
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
      (lower(coalesce(c.name,'') || ' ' || coalesce(p.name,'')) ~ '(arete|dije|pulsera|set|collar)') as grupo_a,
      (lower(coalesce(c.name,'') || ' ' || coalesce(p.name,'')) ~ '(anillo|cadena)') as grupo_b
    from public.order_items oi
    join public.products p on p.id=oi.product_id
    left join public.categories c on c.id=p.category_id
    where oi.order_id=p_order_id
    group by oi.product_id,c.name,p.name
  ) g;
  return round(v_total,2);
end;
$$;

-- 2) El catálogo público registra cabecera + items en una sola operación.
-- WhatsApp se abre DESPUÉS de que esta función termine correctamente.
create or replace function public.submit_catalog_order(
  p_code text, p_customer_name text, p_customer_phone text,
  p_session_id text, p_items jsonb
) returns text
language plpgsql security definer set search_path=public as $$
declare v_submission uuid; v_item jsonb; v_cp uuid; v_qty int;
begin
  if nullif(trim(p_customer_name),'') is null or nullif(trim(p_customer_phone),'') is null then
    raise exception 'Nombre y teléfono son obligatorios';
  end if;
  if p_items is null or jsonb_array_length(p_items)=0 then raise exception 'El pedido no tiene productos'; end if;
  insert into public.catalog_submissions(code,customer_name,customer_phone,session_id,status)
  values(p_code,trim(p_customer_name),trim(p_customer_phone),p_session_id,'pending') returning id into v_submission;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cp=(v_item->>'catalog_product_id')::uuid; v_qty=(v_item->>'quantity')::int;
    if v_qty is null or v_qty<=0 then raise exception 'Cantidad inválida'; end if;
    if not exists(select 1 from public.catalog_products where id=v_cp and active=true) then raise exception 'Producto de catálogo no disponible'; end if;
    insert into public.catalog_submission_items(submission_id,catalog_product_id,quantity) values(v_submission,v_cp,v_qty);
  end loop;
  return p_code;
end;
$$;
revoke all on function public.submit_catalog_order(text,text,text,text,jsonb) from public;
grant execute on function public.submit_catalog_order(text,text,text,text,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
