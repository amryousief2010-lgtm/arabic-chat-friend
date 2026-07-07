
CREATE OR REPLACE FUNCTION public.sync_main_stock_to_sublocations()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_main_wh CONSTANT UUID := '5ec781b5-685b-4806-b59a-83a79ea5662c';
  v_delta NUMERIC;
  v_abs_delta NUMERIC;
  v_remaining NUMERIC;
  v_sub RECORD;
  v_avail NUMERIC;
  v_take NUMERIC;
  v_first_sub UUID;
  v_source TEXT;
  v_ref TEXT;
  v_note TEXT;
  v_mov_id UUID;
  v_mov RECORD;
BEGIN
  IF NEW.warehouse_id <> v_main_wh THEN RETURN NEW; END IF;
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;

  v_delta := COALESCE(NEW.stock, 0) - COALESCE(OLD.stock, 0);
  IF v_delta = 0 THEN RETURN NEW; END IF;
  v_abs_delta := ABS(v_delta);

  -- PASS 1: exact match on quantity + sign direction (prevents swapping under concurrency)
  SELECT im.id, im.movement_type, im.reference_id, im.movement_no, im.notes, im.quantity
    INTO v_mov
  FROM public.inventory_movements im
  WHERE im.item_id = NEW.id
    AND im.performed_at >= now() - interval '30 seconds'
    AND ABS(COALESCE(im.quantity, 0)) = v_abs_delta
    AND (
      (v_delta < 0 AND im.movement_type IN ('sales_dispatch','out','adjust'))
      OR
      (v_delta > 0 AND im.movement_type IN ('sales_return','in','opening_balance','adjust'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.sublocation_movements sm
      WHERE sm.inventory_movement_id = im.id
    )
  ORDER BY im.performed_at DESC, im.created_at DESC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  -- PASS 2: fallback — most recent unlinked (kept for safety, e.g. adjust with unclear sign)
  IF v_mov.id IS NULL THEN
    SELECT im.id, im.movement_type, im.reference_id, im.movement_no, im.notes, im.quantity
      INTO v_mov
    FROM public.inventory_movements im
    WHERE im.item_id = NEW.id
      AND im.performed_at >= now() - interval '30 seconds'
      AND NOT EXISTS (
        SELECT 1 FROM public.sublocation_movements sm
        WHERE sm.inventory_movement_id = im.id
      )
    ORDER BY im.performed_at DESC, im.created_at DESC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
  END IF;

  v_mov_id := v_mov.id;

  IF v_mov_id IS NULL THEN
    v_source := 'manual_adjustment';
    v_ref := NULL;
    v_note := CASE WHEN v_delta < 0
      THEN 'تعديل يدوي — خصم من المخزن الرئيسي'
      ELSE 'تعديل يدوي — إضافة للمخزن الرئيسي' END;
  ELSE
    v_ref := COALESCE(v_mov.reference_id, v_mov.movement_no);
    CASE v_mov.movement_type
      WHEN 'sales_dispatch' THEN
        v_source := 'order_dispatch';
        v_note := 'صرف أوردر' || CASE WHEN v_ref IS NOT NULL THEN ' — ' || v_ref ELSE '' END;
      WHEN 'sales_return' THEN
        v_source := 'sales_return';
        v_note := 'مرتجع مبيعات' || CASE WHEN v_ref IS NOT NULL THEN ' — ' || v_ref ELSE '' END;
      WHEN 'in' THEN
        v_source := 'stock_in';
        v_note := 'دخول مخزون' || CASE WHEN v_ref IS NOT NULL THEN ' — ' || v_ref ELSE '' END;
      WHEN 'out' THEN
        v_source := 'stock_out';
        v_note := 'صرف مخزون' || CASE WHEN v_ref IS NOT NULL THEN ' — ' || v_ref ELSE '' END;
      WHEN 'opening_balance' THEN
        v_source := 'opening_balance';
        v_note := 'رصيد افتتاحي';
      WHEN 'adjust' THEN
        v_source := 'manual_adjustment';
        v_note := 'تعديل يدوي (جرد/تسوية)' || CASE WHEN v_mov.notes IS NOT NULL THEN ' — ' || v_mov.notes ELSE '' END;
      ELSE
        v_source := 'auto_sync';
        v_note := COALESCE(v_mov.notes, 'حركة تلقائية: ' || v_mov.movement_type);
    END CASE;
  END IF;

  IF v_delta < 0 THEN
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
        (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref, inventory_movement_id)
        VALUES (NEW.product_id, v_sub.sublocation_id, NULL, v_take, v_note, auth.uid(), v_source, v_ref, v_mov_id);

      v_mov_id := NULL;
      v_remaining := v_remaining - v_take;
    END LOOP;

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
          (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref, inventory_movement_id)
          VALUES (NEW.product_id, v_first_sub, NULL, v_remaining,
                  v_note || ' — تجاوز المتاح في المكانين', auth.uid(), v_source, v_ref, v_mov_id);
      END IF;
    END IF;
  ELSE
    SELECT id INTO v_first_sub FROM public.warehouse_sublocations
      WHERE warehouse_id = v_main_wh AND is_active = true
      ORDER BY sort_order ASC, created_at ASC LIMIT 1;
    IF v_first_sub IS NOT NULL THEN
      INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock)
        VALUES (v_first_sub, NEW.product_id, v_delta)
        ON CONFLICT (sublocation_id, product_id)
        DO UPDATE SET stock = public.inventory_sublocation_items.stock + v_delta;

      INSERT INTO public.sublocation_movements
        (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref, inventory_movement_id)
        VALUES (NEW.product_id, NULL, v_first_sub, v_delta, v_note, auth.uid(), v_source, v_ref, v_mov_id);
    END IF;
  END IF;

  RETURN NEW;
END; $$;
