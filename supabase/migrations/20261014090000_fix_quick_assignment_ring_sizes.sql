CREATE OR REPLACE FUNCTION public.assign_manual_catalog_batch(
  p_order_id uuid,
  p_items jsonb,
  p_seller_id uuid DEFAULT NULL,
  p_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  pid uuid;
  qty int;
  unit_price numeric;
  talla text;
  disponible int;
  publicado int;
  catid uuid;
  variant text;
  variants jsonb;
  talla_qty int;
  itemid uuid;
  hay_tallas boolean;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Usuario no autorizado';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Lista vacía';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND status IN ('open', 'reopened')) THEN
    RAISE EXCEPTION 'Pedido no abierto';
  END IF;

  FOR v IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    pid := (v ->> 'product_id')::uuid;
    qty := (v ->> 'quantity')::int;
    unit_price := (v ->> 'unit_price')::numeric;
    talla := nullif(trim(v ->> 'ring_size'), '');

    IF pid IS NULL OR qty IS NULL OR qty < 1 THEN
      RAISE EXCEPTION 'Producto o cantidad inválida';
    END IF;

    SELECT stock_available INTO disponible
    FROM public.products
    WHERE id = pid
    FOR UPDATE;

    IF NOT FOUND OR disponible < qty THEN
      RAISE EXCEPTION 'Stock insuficiente';
    END IF;

    SELECT coalesce(sum(
      CASE
        WHEN variant_type = 'ring_size' THEN (
          SELECT coalesce(sum(value::int), 0)
          FROM jsonb_each_text(coalesce(variant_stock, '{}'::jsonb))
        )
        ELSE stock_available
      END
    ), 0)::int
    INTO publicado
    FROM public.catalog_products
    WHERE product_id = pid AND active;

    SELECT EXISTS (
      SELECT 1
      FROM public.catalog_products cp
      WHERE cp.product_id = pid
        AND cp.active
        AND cp.variant_type = 'ring_size'
        AND EXISTS (
          SELECT 1
          FROM jsonb_each_text(coalesce(cp.variant_stock, '{}'::jsonb)) s
          WHERE coalesce(s.value::int, 0) > 0
        )
    )
    INTO hay_tallas;

    catid := NULL;
    variant := NULL;
    variants := '{}'::jsonb;

    IF hay_tallas THEN
      IF talla IS NULL THEN
        -- Permite asignar sin talla únicamente el excedente físico
        -- que no está publicado en el catálogo.
        IF disponible <= publicado THEN
          RAISE EXCEPTION 'Debes elegir una talla para este artículo';
        END IF;
      ELSE
        SELECT id, variant_type, coalesce(variant_stock, '{}'::jsonb)
        INTO catid, variant, variants
        FROM public.catalog_products
        WHERE product_id = pid
          AND active
          AND variant_type = 'ring_size'
          AND coalesce((variant_stock ->> talla)::int, 0) >= qty
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE;

        IF catid IS NULL THEN
          RAISE EXCEPTION 'Talla % no disponible en catálogo', talla;
        END IF;
      END IF;
    ELSIF publicado > 0 AND publicado = disponible THEN
      SELECT id, variant_type, coalesce(variant_stock, '{}'::jsonb)
      INTO catid, variant, variants
      FROM public.catalog_products
      WHERE product_id = pid AND active AND stock_available >= qty
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE;

      IF catid IS NULL THEN
        RAISE EXCEPTION 'Unidades insuficientes en catálogo';
      END IF;
      IF variant IS NOT NULL THEN
        RAISE EXCEPTION 'Debes elegir una variante para este artículo';
      END IF;
    END IF;

    PERFORM public.assign_product_to_order(
      p_order_id,
      pid,
      qty,
      'manual',
      p_seller_id,
      p_session_id,
      unit_price,
      NULL
    );

    IF catid IS NOT NULL THEN
      SELECT id INTO itemid
      FROM public.order_items
      WHERE order_id = p_order_id
        AND product_id = pid
        AND origin = 'manual'
        AND catalog_product_id IS NULL
      ORDER BY assigned_at DESC, id DESC
      LIMIT 1
      FOR UPDATE;

      IF itemid IS NULL THEN
        RAISE EXCEPTION 'No se encontró la asignación nueva';
      END IF;

      UPDATE public.order_items
      SET catalog_product_id = catid,
          ring_size = talla
      WHERE id = itemid;

      IF variant = 'ring_size' THEN
        talla_qty := coalesce((variants ->> talla)::int, 0);
        UPDATE public.catalog_products
        SET stock_available = GREATEST(stock_available - qty, 0),
            variant_stock = jsonb_set(
              variants,
              ARRAY[talla],
              to_jsonb(talla_qty - qty),
              true
            )
        WHERE id = catid;
      ELSE
        UPDATE public.catalog_products
        SET stock_available = LEAST(stock_available, greatest(0, disponible - qty))
        WHERE id = catid;
      END IF;
    END IF;
  END LOOP;
END;
$function$;
