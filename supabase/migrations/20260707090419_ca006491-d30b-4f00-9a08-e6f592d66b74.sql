
-- 1) Extend sublocation_movements to support external in/out (not just transfers)
ALTER TABLE public.sublocation_movements ALTER COLUMN from_sublocation_id DROP NOT NULL;
ALTER TABLE public.sublocation_movements ALTER COLUMN to_sublocation_id DROP NOT NULL;
ALTER TABLE public.sublocation_movements ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.sublocation_movements ADD COLUMN IF NOT EXISTS source_ref TEXT;

-- 2) Replace transfer RPC — now checks against real available (stock - proportional reserved)
CREATE OR REPLACE FUNCTION public.transfer_between_sublocations(
  p_product_id UUID,
  p_from_sublocation_id UUID,
  p_to_sublocation_id UUID,
  p_qty NUMERIC,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from_stock NUMERIC;
  v_move_id UUID;
  v_from_wh UUID;
  v_to_wh UUID;
  v_main_reserved NUMERIC := 0;
  v_sub_total NUMERIC := 0;
  v_reserved_share NUMERIC := 0;
  v_real_available NUMERIC := 0;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر';
  END IF;
  IF p_from_sublocation_id = p_to_sublocation_id THEN
    RAISE EXCEPTION 'لا يمكن النقل إلى نفس المكان';
  END IF;

  SELECT warehouse_id INTO v_from_wh FROM public.warehouse_sublocations WHERE id = p_from_sublocation_id;
  SELECT warehouse_id INTO v_to_wh FROM public.warehouse_sublocations WHERE id = p_to_sublocation_id;
  IF v_from_wh IS NULL OR v_to_wh IS NULL OR v_from_wh <> v_to_wh THEN
    RAISE EXCEPTION 'المكانين يجب أن يكونا في نفس المخزن';
  END IF;

  SELECT stock INTO v_from_stock FROM public.inventory_sublocation_items
    WHERE sublocation_id = p_from_sublocation_id AND product_id = p_product_id
    FOR UPDATE;
  IF v_from_stock IS NULL THEN v_from_stock := 0; END IF;

  -- Compute proportional reserved share for this sublocation
  SELECT COALESCE(SUM(isi.stock), 0) INTO v_sub_total
  FROM public.inventory_sublocation_items isi
  JOIN public.warehouse_sublocations s ON s.id = isi.sublocation_id
  WHERE s.warehouse_id = v_from_wh AND isi.product_id = p_product_id;

  SELECT COALESCE(SUM(reserved_qty), 0) INTO v_main_reserved
  FROM public.inventory_items
  WHERE warehouse_id = v_from_wh AND product_id = p_product_id;

  IF v_sub_total > 0 AND v_main_reserved > 0 THEN
    v_reserved_share := (v_main_reserved * v_from_stock / v_sub_total);
  END IF;
  v_real_available := v_from_stock - v_reserved_share;

  IF p_qty > v_real_available THEN
    RAISE EXCEPTION 'الكمية المطلوبة (%) أكبر من المتاح الحقيقي (%) — باقي الكمية محجوزة لأوردرات', p_qty, ROUND(v_real_available, 3);
  END IF;

  UPDATE public.inventory_sublocation_items
    SET stock = stock - p_qty
    WHERE sublocation_id = p_from_sublocation_id AND product_id = p_product_id;

  INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock)
    VALUES (p_to_sublocation_id, p_product_id, p_qty)
    ON CONFLICT (sublocation_id, product_id)
    DO UPDATE SET stock = public.inventory_sublocation_items.stock + EXCLUDED.stock;

  INSERT INTO public.sublocation_movements
    (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source)
    VALUES (p_product_id, p_from_sublocation_id, p_to_sublocation_id, p_qty, p_notes, auth.uid(), 'manual_transfer')
    RETURNING id INTO v_move_id;

  RETURN v_move_id;
END; $$;

-- 3) Trigger: auto-sync main warehouse stock changes to sublocations
--    - Deduct: freezers first, then fridge (by sort_order ASC)
--    - Add: goes to the first sublocation (freezers)
CREATE OR REPLACE FUNCTION public.sync_main_stock_to_sublocations()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_main_wh CONSTANT UUID := '5ec781b5-685b-4806-b59a-83a79ea5662c';
  v_delta NUMERIC;
  v_remaining NUMERIC;
  v_sub RECORD;
  v_avail NUMERIC;
  v_take NUMERIC;
  v_first_sub UUID;
  v_source TEXT;
  v_ref TEXT;
BEGIN
  IF NEW.warehouse_id <> v_main_wh THEN RETURN NEW; END IF;
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;

  v_delta := COALESCE(NEW.stock, 0) - COALESCE(OLD.stock, 0);
  IF v_delta = 0 THEN RETURN NEW; END IF;

  v_source := 'auto_sync';
  v_ref := NULL;

  IF v_delta < 0 THEN
    -- Deduction: consume from freezers first, then fridge
    v_remaining := -v_delta;
    FOR v_sub IN
      SELECT s.id AS sublocation_id, COALESCE(isi.stock, 0) AS stock
      FROM public.warehouse_sublocations s
      LEFT JOIN public.inventory_sublocation_items isi
        ON isi.sublocation_id = s.id AND isi.product_id = NEW.product_id
      WHERE s.warehouse_id = v_main_wh AND s.is_active = true
      ORDER BY s.sort_order ASC, s.created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_avail := GREATEST(v_sub.stock, 0);
      IF v_avail <= 0 THEN CONTINUE; END IF;
      v_take := LEAST(v_avail, v_remaining);

      UPDATE public.inventory_sublocation_items
        SET stock = stock - v_take
        WHERE sublocation_id = v_sub.sublocation_id AND product_id = NEW.product_id;

      INSERT INTO public.sublocation_movements
        (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref)
        VALUES (NEW.product_id, v_sub.sublocation_id, NULL, v_take,
                'خصم تلقائي عند صرف من المخزن الرئيسي', auth.uid(), v_source, v_ref);

      v_remaining := v_remaining - v_take;
    END LOOP;

    -- If still remaining (shouldn't normally happen), force-deduct from freezers
    IF v_remaining > 0 THEN
      SELECT id INTO v_first_sub FROM public.warehouse_sublocations
        WHERE warehouse_id = v_main_wh AND is_active = true
        ORDER BY sort_order ASC, created_at ASC LIMIT 1;
      IF v_first_sub IS NOT NULL THEN
        INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock)
          VALUES (v_first_sub, NEW.product_id, -v_remaining)
          ON CONFLICT (sublocation_id, product_id)
          DO UPDATE SET stock = public.inventory_sublocation_items.stock - v_remaining;

        INSERT INTO public.sublocation_movements
          (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref)
          VALUES (NEW.product_id, v_first_sub, NULL, v_remaining,
                  'خصم تلقائي — تجاوز المتاح في المكانين', auth.uid(), v_source, v_ref);
      END IF;
    END IF;
  ELSE
    -- Increment: add to first sublocation (freezers)
    SELECT id INTO v_first_sub FROM public.warehouse_sublocations
      WHERE warehouse_id = v_main_wh AND is_active = true
      ORDER BY sort_order ASC, created_at ASC LIMIT 1;
    IF v_first_sub IS NOT NULL THEN
      INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock)
        VALUES (v_first_sub, NEW.product_id, v_delta)
        ON CONFLICT (sublocation_id, product_id)
        DO UPDATE SET stock = public.inventory_sublocation_items.stock + v_delta;

      INSERT INTO public.sublocation_movements
        (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref)
        VALUES (NEW.product_id, NULL, v_first_sub, v_delta,
                'إضافة تلقائية للمخزن الرئيسي', auth.uid(), v_source, v_ref);
    END IF;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_main_stock_to_sublocations ON public.inventory_items;
CREATE TRIGGER trg_sync_main_stock_to_sublocations
AFTER UPDATE OF stock ON public.inventory_items
FOR EACH ROW
WHEN (OLD.stock IS DISTINCT FROM NEW.stock)
EXECUTE FUNCTION public.sync_main_stock_to_sublocations();
