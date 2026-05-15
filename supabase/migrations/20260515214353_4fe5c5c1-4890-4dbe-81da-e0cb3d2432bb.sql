
CREATE OR REPLACE FUNCTION public.recompute_order_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_order_id uuid; v_subtotal numeric;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT COALESCE(SUM(total_price), 0) INTO v_subtotal FROM public.order_items WHERE order_id = v_order_id;
  UPDATE public.orders
    SET subtotal = v_subtotal,
        total = v_subtotal - COALESCE(discount,0),
        updated_at = now()
    WHERE id = v_order_id;
  RETURN NULL;
END;
$function$;

UPDATE public.orders
SET total = COALESCE(subtotal,0) - COALESCE(discount,0);

UPDATE public.orders
SET total_at_delivery = COALESCE(subtotal,0) - COALESCE(discount,0)
WHERE status = 'delivered';
