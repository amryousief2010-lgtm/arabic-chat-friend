
-- Restore shipping inside total for orders that contain offer items
UPDATE public.orders o
SET total = COALESCE(o.subtotal,0) - COALESCE(o.discount,0) + COALESCE(o.delivery_fee,0)
WHERE EXISTS (
  SELECT 1 FROM public.order_items oi
  WHERE oi.order_id = o.id AND oi.offer_name IS NOT NULL
);

UPDATE public.orders o
SET total_at_delivery = COALESCE(o.subtotal,0) - COALESCE(o.discount,0) + COALESCE(o.delivery_fee,0)
WHERE o.status = 'delivered'
  AND EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.order_id = o.id AND oi.offer_name IS NOT NULL
  );

-- Update recompute trigger: add delivery_fee to total ONLY when order contains offer items
CREATE OR REPLACE FUNCTION public.recompute_order_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_subtotal numeric;
  v_has_offer boolean;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT COALESCE(SUM(total_price), 0) INTO v_subtotal FROM public.order_items WHERE order_id = v_order_id;
  SELECT EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id = v_order_id AND offer_name IS NOT NULL
  ) INTO v_has_offer;
  UPDATE public.orders
    SET subtotal = v_subtotal,
        total = v_subtotal - COALESCE(discount,0)
                + CASE WHEN v_has_offer THEN COALESCE(delivery_fee,0) ELSE 0 END,
        updated_at = now()
    WHERE id = v_order_id;
  RETURN NULL;
END;
$function$;
