CREATE OR REPLACE FUNCTION public.sync_main_stock_to_sublocations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Guard against double-deduction: if a movement row for this item was created
  -- in THIS transaction (xmin match) or in the last 60 seconds, the movements
  -- trigger already synced the sublocations.
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements im
    WHERE im.item_id = NEW.id
      AND (
        im.xmin::text = txid_current()::text
        OR COALESCE(im.performed_at, im.created_at) >= now() - interval '60 seconds'
        OR im.created_at >= now() - interval '60 seconds'
      )
  ) THEN
    RETURN NEW;
  END IF;

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
END; $function$;