-- Repair the closed sale that already contains product code 7726.
-- Keep the original close snapshot and payment rows intact; only correct the current total.
do $$
declare
  v_order_id uuid;
begin
  select o.id into v_order_id
  from public.orders o
  where o.order_number = 1439
    and o.status = 'closed'
    and o.total_original = 689.00
    and o.total_cerrado = 689.00
    and exists (
      select 1
      from public.order_items oi
      join public.products p on p.id = oi.product_id
      where oi.order_id = o.id
        and p.code = '7726'
    )
  for update;

  if v_order_id is null then
    raise exception 'Closed sale 1439 no longer matches the expected repair state';
  end if;

  update public.orders
  set total_cerrado = public.calcular_total_items_pedido(v_order_id)
  where id = v_order_id;
end;
$$;
