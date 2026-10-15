-- Match the closed-sale correction total to the established pricing rules:
-- use the product's catalog price (or its recorded manual override), then apply
-- the quantity discount once. Persisted order_items.unit_price may already include
-- the quantity reduction, so it must not be discounted a second time.

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
    sum(oi.quantity) as qty,
    max(p.price) as base,
    max(p.name) as name,
    max(
      case
        when lower(coalesce(p.name, '')) ~ '(aret|dije|pulser|collar|(^|[^a-z])set([^a-z]|$))' then 1
        when lower(coalesce(p.name, '')) ~ '(anill|caden)' then 2
        else 0
      end
    ) as kind,
    max((
      select (al.details->>'precio_nuevo')::numeric
      from public.audit_log al
      where al.action = 'precio_item_pedido_editado'
        and al.details->>'order_id' = p_order_id::text
        and al.details->>'product_id' = oi.product_id::text
      order by al.created_at desc
      limit 1
    )) as manual_price
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.order_id = p_order_id
  group by oi.product_id
),
total as (
  select coalesce(sum(
    qty * greatest(
      0,
      coalesce(manual_price, base) -
      case
        when manual_price is not null then 0
        when kind = 1 then case when qty >= 6 then 2 when qty >= 3 then 1 else 0 end
        when kind = 2 then case when qty >= 12 then 2 when qty >= 6 then 1 else 0 end
        else 0
      end
    )
  ), 0) as amount
  from grouped
)
select round(amount, 2) from total;
$$;

revoke all on function public.calcular_total_items_pedido(uuid) from public;
