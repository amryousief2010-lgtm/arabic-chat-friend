
-- 1) New trigger on inventory_movements: direct linkage, no guessing
CREATE OR REPLACE FUNCTION public.sync_sublocations_from_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_main_wh CONSTANT UUID := '5ec781b5-685b-4806-b59a-83a79ea5662c';
  v_signed NUMERIC;
  v_remaining NUMERIC;
  v_sub RECORD;
  v_avail NUMERIC;
  v_take NUMERIC;
  v_first_sub UUID;
  v_source TEXT;
  v_ref TEXT;
  v_note TEXT;
  v_mov_id UUID;
  v_product UUID;
BEGIN
  IF NEW.warehouse_id IS DISTINCT FROM v_main_wh THEN RETURN NEW; END IF;
  v_product := COALESCE(NEW.product_id, (SELECT product_id FROM public.inventory_items WHERE id = NEW.item_id));
  IF v_product IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.quantity, 0) = 0 THEN RETURN NEW; END IF;

  -- Compute signed delta from movement type
  v_signed := CASE NEW.movement_type
    WHEN 'sales_dispatch'  THEN -ABS(NEW.quantity)
    WHEN 'out'             THEN -ABS(NEW.quantity)
    WHEN 'sales_return'    THEN  ABS(NEW.quantity)
    WHEN 'in'              THEN  ABS(NEW.quantity)
    WHEN 'opening_balance' THEN  ABS(NEW.quantity)
    WHEN 'adjust'          THEN  NEW.quantity  -- assume caller signs correctly
    ELSE 0
  END;
  IF v_signed = 0 THEN RETURN NEW; END IF;

  v_mov_id := NEW.id;
  v_ref := COALESCE(NEW.reference_id, NEW.movement_no, NEW.reference);

  v_source := CASE NEW.movement_type
    WHEN 'sales_dispatch'  THEN 'order_dispatch'
    WHEN 'sales_return'    THEN 'sales_return'
    WHEN 'in'              THEN 'stock_in'
    WHEN 'out'             THEN 'stock_out'
    WHEN 'opening_balance' THEN 'opening_balance'
    WHEN 'adjust'          THEN 'manual_adjustment'
    ELSE 'auto_sync'
  END;

  v_note := CASE NEW.movement_type
    WHEN 'sales_dispatch'  THEN 'صرف أوردر' || COALESCE(' — ' || v_ref, '')
    WHEN 'sales_return'    THEN 'مرتجع مبيعات' || COALESCE(' — ' || v_ref, '')
    WHEN 'in'              THEN 'دخول مخزون' || COALESCE(' — ' || v_ref, '')
    WHEN 'out'             THEN 'صرف مخزون' || COALESCE(' — ' || v_ref, '')
    WHEN 'opening_balance' THEN 'رصيد افتتاحي'
    WHEN 'adjust'          THEN 'تعديل (جرد/تسوية)' || COALESCE(' — ' || NEW.notes, '')
    ELSE COALESCE(NEW.notes, 'حركة: ' || NEW.movement_type)
  END;

  IF v_signed < 0 THEN
    v_remaining := -v_signed;
    FOR v_sub IN
      SELECT s.id AS sublocation_id, COALESCE(isi.stock, 0) AS stock
      FROM public.warehouse_sublocations s
      LEFT JOIN public.inventory_sublocation_items isi
        ON isi.sublocation_id = s.id AND isi.product_id = v_product
      WHERE s.warehouse_id = v_main_wh AND s.is_active = true
      ORDER BY s.sort_order ASC, s.created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_avail := GREATEST(v_sub.stock, 0);
      IF v_avail <= 0 THEN CONTINUE; END IF;
      v_take := LEAST(v_avail, v_remaining);

      UPDATE public.inventory_sublocation_items
        SET stock = stock - v_take
        WHERE sublocation_id = v_sub.sublocation_id AND product_id = v_product;

      INSERT INTO public.sublocation_movements
        (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref, inventory_movement_id)
        VALUES (v_product, v_sub.sublocation_id, NULL, v_take, v_note, COALESCE(NEW.performed_by, auth.uid()), v_source, v_ref, v_mov_id);

      v_mov_id := NULL; -- unique constraint: link only the first sub-row
      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      SELECT id INTO v_first_sub FROM public.warehouse_sublocations
        WHERE warehouse_id = v_main_wh AND is_active = true
        ORDER BY sort_order ASC, created_at ASC LIMIT 1;
      IF v_first_sub IS NOT NULL THEN
        INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock)
          VALUES (v_first_sub, v_product, -v_remaining)
          ON CONFLICT (sublocation_id, product_id)
          DO UPDATE SET stock = public.inventory_sublocation_items.stock - v_remaining;

        INSERT INTO public.sublocation_movements
          (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref, inventory_movement_id)
          VALUES (v_product, v_first_sub, NULL, v_remaining,
                  v_note || ' — تجاوز المتاح', COALESCE(NEW.performed_by, auth.uid()), v_source, v_ref, v_mov_id);
      END IF;
    END IF;
  ELSE
    SELECT id INTO v_first_sub FROM public.warehouse_sublocations
      WHERE warehouse_id = v_main_wh AND is_active = true
      ORDER BY sort_order ASC, created_at ASC LIMIT 1;
    IF v_first_sub IS NOT NULL THEN
      INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock)
        VALUES (v_first_sub, v_product, v_signed)
        ON CONFLICT (sublocation_id, product_id)
        DO UPDATE SET stock = public.inventory_sublocation_items.stock + v_signed;

      INSERT INTO public.sublocation_movements
        (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref, inventory_movement_id)
        VALUES (v_product, NULL, v_first_sub, v_signed, v_note, COALESCE(NEW.performed_by, auth.uid()), v_source, v_ref, v_mov_id);
    END IF;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_sublocations_from_movement ON public.inventory_movements;
CREATE TRIGGER trg_sync_sublocations_from_movement
AFTER INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.sync_sublocations_from_movement();

-- 2) Simplify items trigger: only handle MANUAL edits (no movement row)
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
  v_note TEXT;
BEGIN
  IF NEW.warehouse_id <> v_main_wh THEN RETURN NEW; END IF;
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;

  v_delta := COALESCE(NEW.stock, 0) - COALESCE(OLD.stock, 0);
  IF v_delta = 0 THEN RETURN NEW; END IF;

  -- If ANY inventory_movement was recorded for this item in the last 10 seconds,
  -- assume the movements trigger already handled the sublocation sync.
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements im
    WHERE im.item_id = NEW.id
      AND im.performed_at >= now() - interval '10 seconds'
  ) THEN
    RETURN NEW;
  END IF;

  -- Otherwise: this is a bare UPDATE with no movement row → manual adjustment
  v_note := CASE WHEN v_delta < 0
    THEN 'تعديل يدوي — خصم مباشر من رصيد المخزن الرئيسي'
    ELSE 'تعديل يدوي — إضافة مباشرة لرصيد المخزن الرئيسي' END;

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
        (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref)
        VALUES (NEW.product_id, v_sub.sublocation_id, NULL, v_take, v_note, auth.uid(), 'manual_adjustment', NULL);

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
                  v_note || ' — تجاوز المتاح', auth.uid(), 'manual_adjustment', NULL);
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
        (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source, source_ref)
        VALUES (NEW.product_id, NULL, v_first_sub, v_delta, v_note, auth.uid(), 'manual_adjustment', NULL);
    END IF;
  END IF;

  RETURN NEW;
END; $$;
