
CREATE OR REPLACE FUNCTION public.set_order_source_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_warehouse_id IS NULL THEN
      NEW.source_warehouse_id := public.resolve_order_source_warehouse(NEW.shipping_company);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.source_warehouse_id IS NOT DISTINCT FROM OLD.source_warehouse_id THEN
      NEW.source_warehouse_id := public.resolve_order_source_warehouse(NEW.shipping_company);
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

DO $$
DECLARE
  v_order_id uuid := 'aaff4384-240e-46af-aacf-1568aff7c7c0';
  v_wh uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
  r record;
  v_inv_id uuid;
BEGIN
  UPDATE public.orders
     SET source_warehouse_id = v_wh,
         stock_status = 'dispatched'
   WHERE id = v_order_id
     AND source_warehouse_id IS NULL;

  FOR r IN
    SELECT product_id, quantity FROM public.order_items WHERE order_id = v_order_id
  LOOP
    SELECT id INTO v_inv_id FROM public.inventory_items
     WHERE warehouse_id = v_wh AND product_id = r.product_id LIMIT 1;

    IF v_inv_id IS NULL THEN
      INSERT INTO public.inventory_items (warehouse_id, product_id, stock, reserved_qty, blocked_qty)
      VALUES (v_wh, r.product_id, 0, 0, 0)
      RETURNING id INTO v_inv_id;
    END IF;

    UPDATE public.inventory_items SET stock = COALESCE(stock,0) - r.quantity WHERE id = v_inv_id;

    INSERT INTO public.inventory_movements (
      warehouse_id, item_id, product_id, movement_type, quantity,
      reference_type, reference_id, notes
    ) VALUES (
      v_wh, v_inv_id, r.product_id, 'sales_dispatch', -r.quantity,
      'order', v_order_id, 'backfill: source_warehouse lost by old trigger'
    );
  END LOOP;
END $$;
