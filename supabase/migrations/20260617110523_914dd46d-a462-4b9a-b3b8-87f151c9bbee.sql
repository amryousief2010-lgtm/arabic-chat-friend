
-- Fix 1: Prevent double-deduction in slaughter_ostrich_feed_consumption.
-- The previous function deducted from inventory directly AND inserted a 'consumption'
-- movement which is also processed by slaughterhouse_feed_apply → double subtract.
-- We now only insert the movement row and let the movement trigger update inventory.
CREATE OR REPLACE FUNCTION public.slaughter_ostrich_feed_consumption_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stock_before numeric;
  v_unit_cost numeric;
BEGIN
  SELECT current_kg, last_unit_cost INTO v_stock_before, v_unit_cost
    FROM public.slaughterhouse_feed_inventory
   WHERE id = NEW.feed_inventory_id
   FOR UPDATE;

  IF v_stock_before IS NULL THEN
    RAISE EXCEPTION 'Feed inventory item not found';
  END IF;

  IF v_stock_before < NEW.quantity_kg THEN
    RAISE EXCEPTION 'الرصيد غير كافٍ في مخزن علف المجزر. الرصيد المتاح: %, الكمية المطلوبة: %', v_stock_before, NEW.quantity_kg;
  END IF;

  NEW.stock_before := v_stock_before;
  NEW.stock_after  := v_stock_before - NEW.quantity_kg;
  IF NEW.unit_cost IS NULL OR NEW.unit_cost = 0 THEN
    NEW.unit_cost := COALESCE(v_unit_cost, 0);
  END IF;
  NEW.total_cost := NEW.quantity_kg * NEW.unit_cost;

  -- Insert movement; slaughterhouse_feed_apply trigger will deduct inventory.
  INSERT INTO public.slaughterhouse_feed_movements
    (feed_id, movement_type, quantity_kg, unit_cost, total_cost,
     source_type, source_id, reference_no, notes, performed_by)
  VALUES
    (NEW.feed_inventory_id, 'consumption', NEW.quantity_kg, NEW.unit_cost, NEW.total_cost,
     'slaughter_ostrich_feed_consumption', NEW.id, NEW.reference_id,
     COALESCE(NEW.notes,'صرف علف لدفعة نعام'), COALESCE(NEW.responsible_user_id, NEW.created_by));

  RETURN NEW;
END;
$function$;

-- Fix 2: Server-side guard — prevent any consumption movement from making inventory negative.
CREATE OR REPLACE FUNCTION public.slaughterhouse_feed_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  delta numeric;
  cur_kg numeric;
BEGIN
  IF NEW.movement_type IN ('factory_supply','opening') THEN delta := NEW.quantity_kg;
  ELSIF NEW.movement_type = 'consumption' THEN delta := -NEW.quantity_kg;
  ELSE delta := NEW.quantity_kg; END IF;

  SELECT current_kg INTO cur_kg FROM public.slaughterhouse_feed_inventory
   WHERE id = NEW.feed_id FOR UPDATE;

  IF NEW.movement_type = 'consumption' AND COALESCE(cur_kg,0) + delta < 0 THEN
    RAISE EXCEPTION 'الرصيد غير كافٍ في مخزن علف المجزر. الرصيد المتاح: %, الكمية المطلوبة: %',
      COALESCE(cur_kg,0), NEW.quantity_kg;
  END IF;

  UPDATE public.slaughterhouse_feed_inventory
     SET current_kg = current_kg + delta,
         last_unit_cost = CASE WHEN NEW.unit_cost > 0 THEN NEW.unit_cost ELSE last_unit_cost END,
         updated_at = now()
   WHERE id = NEW.feed_id;

  INSERT INTO public.slaughterhouse_feed_audit_log(action, movement_id, feed_id, performed_by, details)
  VALUES (NEW.movement_type, NEW.id, NEW.feed_id, NEW.performed_by,
          jsonb_build_object('qty', NEW.quantity_kg, 'source_type', NEW.source_type,
                             'source_id', NEW.source_id, 'invoice_no', NEW.invoice_no));
  RETURN NEW;
END;
$function$;

-- Fix 3: Repair the negative balance caused by historical double-deduction (+40 adjustment).
-- This logs a transparent adjustment movement, no treasury impact.
INSERT INTO public.slaughterhouse_feed_movements
  (feed_id, movement_type, quantity_kg, unit_cost, total_cost,
   source_type, reference_no, notes, performed_by, performed_at)
SELECT
  'be11da5d-a8f9-4c07-b2a9-141b7f7e966b'::uuid,
  'adjustment',
  40,
  last_unit_cost,
  40 * last_unit_cost,
  'system_correction',
  'fix_double_deduct_ostrich_consumption_2026-06-17',
  'تصحيح: عكس خصم مزدوج كان يحدث في صرف علف النعام (تحديث الدالة) — استرجاع 40 كجم',
  NULL,
  now()
FROM public.slaughterhouse_feed_inventory
WHERE id = 'be11da5d-a8f9-4c07-b2a9-141b7f7e966b'
  AND current_kg < 0
  AND NOT EXISTS (
    SELECT 1 FROM public.slaughterhouse_feed_movements
    WHERE reference_no = 'fix_double_deduct_ostrich_consumption_2026-06-17'
  );
