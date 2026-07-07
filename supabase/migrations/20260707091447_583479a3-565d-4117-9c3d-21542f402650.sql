
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
  v_note TEXT;
  v_mov RECORD;
BEGIN
  IF NEW.warehouse_id <> v_main_wh THEN RETURN NEW; END IF;
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;

  v_delta := COALESCE(NEW.stock, 0) - COALESCE(OLD.stock, 0);
  IF v_delta = 0 THEN RETURN NEW; END IF;

  -- Try to identify the triggering inventory movement (most recent within 5 seconds for this item)
  SELECT movement_type, reference_id, reference_type, movement_no, notes, quantity
    INTO v_mov
  FROM public.inventory_movements
  WHERE item_id = NEW.id
    AND performed_at >= now() - interval '5 seconds'
  ORDER BY performed_at DESC, created_at DESC
  LIMIT 1;

  IF v_mov.movement_type IS NULL THEN
    -- No matching movement row → direct UPDATE, treat as manual adjustment
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
        v_note := COALESCE(v_mov.notes, 'حركة تلقائية');
    END CASE;
  END IF;

  IF v_delta < 0 THEN
    -- Deduction: freezers first, then fridge
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
        VALUES (NEW.product_id, v_sub.sublocation_id, NULL, v_take, v_note, auth.uid(), v_source, v_ref);

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
          (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref)
          VALUES (NEW.product_id, v_first_sub, NULL, v_remaining,
                  v_note || ' — تجاوز المتاح في المكانين', auth.uid(), v_source, v_ref);
      END IF;
    END IF;
  ELSE
    -- Increment: add to freezers
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
        VALUES (NEW.product_id, NULL, v_first_sub, v_delta, v_note, auth.uid(), v_source, v_ref);
    END IF;
  END IF;

  RETURN NEW;
END; $$;
