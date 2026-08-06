CREATE OR REPLACE FUNCTION public.sync_main_stock_to_sublocations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_main_wh CONSTANT uuid := '5ec781b5-685b-4806-b59a-83a79ea5662c';
  v_freezer CONSTANT uuid := '0fc8b6bd-5271-404d-a716-bd3e5df86859';
  v_old_freezer_stock numeric := 0;
  v_new_stock numeric := COALESCE(NEW.stock, 0);
  v_delta numeric;
  v_note text;
BEGIN
  IF NEW.warehouse_id IS DISTINCT FROM v_main_wh OR NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(stock, 0)
    INTO v_old_freezer_stock
  FROM public.inventory_sublocation_items
  WHERE sublocation_id = v_freezer
    AND product_id = NEW.product_id;

  v_old_freezer_stock := COALESCE(v_old_freezer_stock, 0);
  v_delta := v_new_stock - v_old_freezer_stock;

  INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock)
  VALUES (v_freezer, NEW.product_id, v_new_stock)
  ON CONFLICT (sublocation_id, product_id)
  DO UPDATE SET stock = EXCLUDED.stock;

  IF v_delta <> 0 THEN
    v_note := 'مزامنة تلقائية مع الرصيد الفعلي للمخزن الرئيسي';

    INSERT INTO public.sublocation_movements
      (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref)
    VALUES
      (NEW.product_id,
       CASE WHEN v_delta < 0 THEN v_freezer ELSE NULL END,
       CASE WHEN v_delta > 0 THEN v_freezer ELSE NULL END,
       ABS(v_delta),
       v_note,
       auth.uid(),
       'auto_sync',
       'MAIN-STOCK-MIRROR');
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_sublocations_from_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- inventory_items.stock is the single source of truth.
  -- Its trigger mirrors the final balance exactly, so movement-level delta syncing
  -- must not run as well or the same movement would be applied twice.
  RETURN NEW;
END;
$function$;