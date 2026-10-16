-- Explicit catalog sourced reservation for a customer order.
-- Keep catalog stock and inventory reservations in one transaction and preserve the
-- publication id so remove_order_item_unit can restore the exact publication.
CREATE OR REPLACE FUNCTION public.assign_catalog_product_to_order(
  p_order_id uuid,
  p_catalog_product_id uuid,
  p_quantity integer,
  p_seller_id uuid DEFAULT NULL,
  p_session_id uuid DEFAULT NULL,
  p_unit_price numeric DEFAULT NULL,
  p_variant_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid;
  v_available integer;
  v_price numeric(10,2);
  v_order_status text;
  v_variant_type text;
  v_variant_stock jsonb;
  v_variant_quantity integer;
  v_size_stock jsonb;
  v_size_reserved integer;
  v_size_available integer;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Usuario no autorizado';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a cero';
  END IF;

  SELECT status
  INTO v_order_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_order_status NOT IN ('open', 'reopened') THEN
    RAISE EXCEPTION 'Pedido no abierto';
  END IF;

  -- Read the product id first, then lock inventory followed by the publication.
  SELECT product_id
  INTO v_product_id
  FROM public.catalog_products
  WHERE id = p_catalog_product_id
    AND active = true;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró una publicación activa';
  END IF;

  SELECT stock_available, price, COALESCE(size_stock, '{}'::jsonb)
  INTO v_available, v_price, v_size_stock
  FROM public.products
  WHERE id = v_product_id
    AND active = true
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el producto en inventario';
  END IF;

  SELECT variant_type, COALESCE(variant_stock, '{}'::jsonb)
  INTO v_variant_type, v_variant_stock
  FROM public.catalog_products
  WHERE id = p_catalog_product_id
    AND product_id = v_product_id
    AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La publicación cambió o dejó de estar activa';
  END IF;

  IF v_available < p_quantity THEN
    RAISE EXCEPTION
      'No hay suficiente stock disponible (disponible: %, pedido: %)',
      v_available, p_quantity;
  END IF;

  IF v_variant_type IS NULL THEN
    IF NULLIF(TRIM(COALESCE(p_variant_key, '')), '') IS NOT NULL THEN
      RAISE EXCEPTION 'Este producto no tiene variantes';
    END IF;
    IF (SELECT stock_available FROM public.catalog_products WHERE id = p_catalog_product_id) < p_quantity THEN
      RAISE EXCEPTION 'Unidades insuficientes en catálogo';
    END IF;
  ELSE
    IF NULLIF(TRIM(COALESCE(p_variant_key, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Debes elegir una variante';
    END IF;

    v_variant_quantity := COALESCE((v_variant_stock ->> p_variant_key)::integer, 0);
    IF v_variant_quantity < p_quantity THEN
      RAISE EXCEPTION 'No hay suficientes unidades de la variante % en catálogo', p_variant_key;
    END IF;

    IF v_variant_type = 'ring_size' THEN
      v_size_available := COALESCE((v_size_stock ->> p_variant_key)::integer, 0);
      SELECT COALESCE(SUM(oi.quantity), 0)::integer
      INTO v_size_reserved
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.product_id = v_product_id
        AND oi.ring_size = p_variant_key
        AND o.status IN ('open', 'reopened');

      v_size_available := v_size_available - v_size_reserved;
      IF v_size_available < p_quantity THEN
        RAISE EXCEPTION
          'No hay suficiente stock disponible de talla % (disponible: %, pedido: %)',
          p_variant_key, GREATEST(v_size_available, 0), p_quantity;
      END IF;
    END IF;
  END IF;

  IF p_unit_price IS NOT NULL THEN
    IF p_unit_price < 0 THEN
      RAISE EXCEPTION 'El precio no puede ser negativo';
    END IF;
    v_price := ROUND(p_unit_price, 2);
  END IF;

  -- Decrement the publication first. The products trigger only clamps catalog
  -- stock when it exceeds inventory; this order prevents a second decrement.
  UPDATE public.catalog_products
  SET stock_available = stock_available - p_quantity,
      variant_stock = CASE
        WHEN v_variant_type IS NOT NULL THEN jsonb_set(
          v_variant_stock,
          ARRAY[p_variant_key],
          to_jsonb(v_variant_quantity - p_quantity),
          true
        )
        ELSE variant_stock
      END
  WHERE id = p_catalog_product_id;

  UPDATE public.products
  SET stock_reserved = stock_reserved + p_quantity,
      updated_at = now()
  WHERE id = v_product_id;

  INSERT INTO public.order_items (
    order_id, product_id, quantity, unit_price, origin, assigned_by,
    seller_id, session_id, ring_size, catalog_product_id
  )
  VALUES (
    p_order_id, v_product_id, p_quantity, v_price, 'catalogo', auth.uid(),
    p_seller_id, p_session_id,
    CASE WHEN v_variant_type = 'ring_size' THEN p_variant_key ELSE NULL END,
    p_catalog_product_id
  );

  INSERT INTO public.order_item_history (
    order_id, product_id, quantity_delta, unit_price, origin, performed_by
  )
  VALUES (
    p_order_id, v_product_id, p_quantity, v_price, 'catalogo', auth.uid()
  );

  INSERT INTO public.inventory_movements (
    product_id, type, quantity_delta, order_id, performed_by
  )
  VALUES (
    v_product_id, 'asignacion', -p_quantity, p_order_id, auth.uid()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_catalog_product_to_order(uuid, uuid, integer, uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_catalog_product_to_order(uuid, uuid, integer, uuid, uuid, numeric, text) TO authenticated;
