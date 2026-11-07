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
begin
  if not public.is_staff() then
    raise exception 'Usuario no autorizado';
  end if;

  -- Reuse the existing assignment path so stock, catalog, and ring sizes keep
  -- their current behavior. Price auditing stays in the same transaction.
  perform public.assign_manual_catalog_batch(
    p_order_id,
    p_items,
    p_seller_id,
    p_session_id
  );

  for v_item in
    select value
    from jsonb_array_elements(p_items)
    where value ->> 'manual_price' = 'true'
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_unit_price := (v_item ->> 'unit_price')::numeric;

    if v_product_id is null or v_unit_price is null or v_unit_price < 0 then
      raise exception 'Precio manual inválido';
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
        'origen', 'asignacion_manual'
      )
    );
  end loop;
end;
$function$;

revoke all on function public.assign_manual_catalog_batch_with_price_audit(uuid, jsonb, uuid, uuid) from public, anon;
grant execute on function public.assign_manual_catalog_batch_with_price_audit(uuid, jsonb, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';