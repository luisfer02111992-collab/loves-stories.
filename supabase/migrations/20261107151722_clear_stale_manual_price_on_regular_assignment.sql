create or replace function public.assign_manual_catalog_batch_with_price_audit(
  p_order_id uuid,
  p_items jsonb,
  p_seller_id uuid default null,
  p_session_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_item jsonb;
  v_product_id uuid;
  v_unit_price numeric;
  v_manual_price boolean;
begin
  if not public.is_staff() then
    raise exception 'Usuario no autorizado';
  end if;

  perform public.assign_manual_catalog_batch(
    p_order_id,
    p_items,
    p_seller_id,
    p_session_id
  );

  -- Record the latest price state for every product in this assignment.
  -- A regular price explicitly clears any previous manual override in this order.
  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_unit_price := (v_item ->> 'unit_price')::numeric;
    v_manual_price := coalesce((v_item ->> 'manual_price')::boolean, false);

    if v_product_id is null or v_unit_price is null or v_unit_price < 0 then
      raise exception 'Precio de asignación inválido';
    end if;

    insert into public.audit_log (actor, action, details)
    values (
      auth.uid(),
      'precio_item_pedido_editado',
      jsonb_build_object(
        'order_id', p_order_id,
        'product_id', v_product_id,
        'precios_anteriores', '[]'::jsonb,
        'precio_nuevo', v_unit_price,
        'manual_price', v_manual_price,
        'origen', 'asignacion_manual'
      )
    );
  end loop;
end;
$function$;

revoke all on function public.assign_manual_catalog_batch_with_price_audit(uuid, jsonb, uuid, uuid) from public, anon;
grant execute on function public.assign_manual_catalog_batch_with_price_audit(uuid, jsonb, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';