
-- Brooding feed issuance: enforce inventory deduction via feed_id + idempotency

-- 1) Add columns (non-destructive)
ALTER TABLE public.brooding_feed_issuance
  ADD COLUMN IF NOT EXISTS feed_id uuid REFERENCES public.brooding_feed_inventory(id),
  ADD COLUMN IF NOT EXISTS reference_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS stock_before numeric,
  ADD COLUMN IF NOT EXISTS stock_after  numeric;

CREATE UNIQUE INDEX IF NOT EXISTS uq_brooding_feed_issuance_reference
  ON public.brooding_feed_issuance(reference_id);

-- 2) Strict deduction trigger (replaces existing function body):
--    - resolves inventory row by feed_id first, then by feed_name
--    - raises if not found or insufficient
--    - writes stock_before/stock_after on the row itself (NEW)
--    - inserts a single 'consumption' stock movement (idempotent via source_id = NEW.id)
CREATE OR REPLACE FUNCTION public.brooding_feed_deduct_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  inv RECORD;
BEGIN
  IF NEW.quantity_kg IS NULL OR NEW.quantity_kg <= 0 THEN
    RAISE EXCEPTION 'كمية الصرف يجب أن تكون أكبر من صفر';
  END IF;
  IF NEW.batch_id IS NULL THEN
    RAISE EXCEPTION 'يجب اختيار الدفعة';
  END IF;

  IF NEW.feed_id IS NOT NULL THEN
    SELECT * INTO inv FROM public.brooding_feed_inventory WHERE id = NEW.feed_id FOR UPDATE;
  ELSE
    SELECT * INTO inv FROM public.brooding_feed_inventory WHERE feed_name = NEW.feed_name FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'نوع العلف "%" غير موجود في مخزون علف حضانات الكتاكيت', NEW.feed_name;
  END IF;

  IF inv.current_kg < NEW.quantity_kg THEN
    RAISE EXCEPTION 'الكمية المطلوبة أكبر من مخزون العلف المتاح (المتاح: % كجم، المطلوب: % كجم)',
      inv.current_kg, NEW.quantity_kg;
  END IF;

  UPDATE public.brooding_feed_inventory
    SET current_kg = current_kg - NEW.quantity_kg,
        last_unit_cost = COALESCE(NULLIF(NEW.unit_cost,0), last_unit_cost),
        updated_at = now()
    WHERE id = inv.id;

  -- record snapshots on the issuance row
  UPDATE public.brooding_feed_issuance
    SET feed_id = inv.id,
        stock_before = inv.current_kg,
        stock_after  = inv.current_kg - NEW.quantity_kg
    WHERE id = NEW.id;

  -- log consumption movement (idempotent: unique source_id)
  INSERT INTO public.brooding_feed_stock_movements
    (feed_id, movement_type, quantity_kg, unit_cost, total_cost,
     batch_id, notes, created_by, source_type, source_id)
  VALUES
    (inv.id, 'consumption', NEW.quantity_kg, NEW.unit_cost, NEW.total_cost,
     NEW.batch_id, NEW.notes, NEW.created_by, 'brooding_feed_issuance', NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_brooding_feed_stock_consumption_source
  ON public.brooding_feed_stock_movements(source_type, source_id)
  WHERE source_type = 'brooding_feed_issuance';
