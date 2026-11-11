CREATE OR REPLACE FUNCTION public.calcular_total_pedido(p_order_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH pedido AS (
 SELECT status,total_cerrado FROM public.orders WHERE id=p_order_id
), grouped AS (
 SELECT oi.product_id, SUM(oi.quantity) qty, MAX(p.price) base, MAX(p.name) name,
 MAX(CASE WHEN lower(coalesce(p.name,'')) ~ '(aret|dije|pulser|collar|(^|[^a-z])set([^a-z]|$))' THEN 1 WHEN lower(coalesce(p.name,'')) ~ '(anill|caden)' THEN 2 ELSE 0 END) kind,
 MAX((SELECT CASE WHEN al.details->>'manual_price' IS DISTINCT FROM 'false' THEN (al.details->>'precio_nuevo')::numeric END FROM public.audit_log al WHERE al.action='precio_item_pedido_editado' AND al.details->>'order_id'=p_order_id::text AND al.details->>'product_id'=oi.product_id::text ORDER BY al.created_at DESC LIMIT 1)) manual_price
 FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id
 WHERE oi.order_id=p_order_id GROUP BY oi.product_id
), total_abierto AS (
 SELECT COALESCE(SUM(qty * GREATEST(0,COALESCE(manual_price,base) - CASE WHEN manual_price IS NOT NULL THEN 0 WHEN kind=1 THEN CASE WHEN qty>=6 THEN 2 WHEN qty>=3 THEN 1 ELSE 0 END WHEN kind=2 THEN CASE WHEN qty>=12 THEN 2 WHEN qty>=6 THEN 1 ELSE 0 END ELSE 0 END)),0) AS total FROM grouped
)
SELECT CASE WHEN pedido.status='closed' THEN COALESCE(pedido.total_cerrado,0) ELSE total_abierto.total END
FROM pedido CROSS JOIN total_abierto;
$function$;
