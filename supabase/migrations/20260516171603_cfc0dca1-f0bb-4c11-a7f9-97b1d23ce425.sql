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
  v_extra numeric;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT COALESCE(SUM(total_price), 0) INTO v_subtotal FROM public.order_items WHERE order_id = v_order_id;
  SELECT EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id = v_order_id AND offer_name IS NOT NULL
  ) INTO v_has_offer;
  SELECT COALESCE(extra_charge, 0) INTO v_extra FROM public.orders WHERE id = v_order_id;
  UPDATE public.orders
    SET subtotal = v_subtotal,
        total = v_subtotal - COALESCE(discount,0)
                + COALESCE(v_extra, 0)
                + CASE WHEN v_has_offer THEN COALESCE(delivery_fee,0) ELSE 0 END,
        updated_at = now()
    WHERE id = v_order_id;
  RETURN NULL;
END;
$function$;