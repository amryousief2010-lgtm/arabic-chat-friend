-- Item edits (add box, remove box, swap, quantity) recompute subtotal/total
-- but must not drop orders.delivery_fee. Shipping is independent of offer lines.
-- A non-zero header fee is what the employee saved. A legacy «تكلفة الشحن» line
-- is used only when that header fee is still 0, and it is not added on top.

CREATE OR REPLACE FUNCTION public.recompute_order_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_subtotal numeric;
  v_line_shipping numeric;
  v_header numeric;
  v_extra numeric;
  v_discount numeric;
  v_shipping numeric;
BEGIN
  IF current_setting('app.skip_order_recompute', true) = 'on' THEN
    RETURN NULL;
  END IF;

  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  SELECT
    COALESCE(SUM(total_price) FILTER (
      WHERE NOT (
        offer_name IS NOT NULL
        AND product_id IS NULL
        AND btrim(COALESCE(product_name, '')) = 'تكلفة الشحن'
      )
    ), 0),
    COALESCE(SUM(total_price) FILTER (
      WHERE offer_name IS NOT NULL
        AND product_id IS NULL
        AND btrim(COALESCE(product_name, '')) = 'تكلفة الشحن'
    ), 0)
  INTO v_subtotal, v_line_shipping
  FROM public.order_items
  WHERE order_id = v_order_id;

  SELECT
    COALESCE(extra_charge, 0),
    COALESCE(discount, 0),
    COALESCE(delivery_fee, 0)
  INTO v_extra, v_discount, v_header
  FROM public.orders
  WHERE id = v_order_id;

  v_shipping := CASE
    WHEN v_header <> 0 THEN v_header
    ELSE COALESCE(v_line_shipping, 0)
  END;

  UPDATE public.orders
    SET subtotal = v_subtotal,
        total = v_subtotal - v_discount + COALESCE(v_extra, 0) + v_shipping,
        updated_at = now()
    WHERE id = v_order_id;

  RETURN NULL;
END;
$$;
