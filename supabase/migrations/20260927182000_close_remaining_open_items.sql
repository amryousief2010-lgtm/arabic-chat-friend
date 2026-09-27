-- Close the remaining open inventory items.
-- Manual posts take a client request key. Freezer rows are a mirror and are
-- excluded from report totals. Stale RPCs raise before any stock write.
-- Old mf receipt requires a product card. Finished-item stock is read-only.
-- A courier return line is unique. Old packaging deductions return once to
-- the packaging warehouse.

-- ---------------------------------------------------------------------------
-- 2. Manual request key. Same key + same item = one movement.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.post_manual_inventory_movement(uuid, text, numeric, text, text, text, text, text, timestamptz, text, numeric, numeric);

CREATE OR REPLACE FUNCTION public.post_manual_inventory_movement(
  p_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reason text,
  p_notes text DEFAULT NULL,
  p_party text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_performed_at timestamptz DEFAULT NULL,
  p_override_reason text DEFAULT NULL,
  p_package_count numeric DEFAULT NULL,
  p_package_weight_kg numeric DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_type text := lower(btrim(COALESCE(p_movement_type, '')));
  v_qty numeric := p_quantity;
  v_source text;
  v_source_id uuid;
  v_line text;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: السبب مطلوب (٣ حروف على الأقل)';
  END IF;
  IF v_type NOT IN ('in', 'out', 'adjustment') THEN
    RAISE EXCEPTION 'INVALID_TYPE: نوع الحركة يجب أن يكون in أو out أو adjustment';
  END IF;
  IF v_type = 'adjustment' THEN
    IF v_qty IS NULL OR v_qty = 0 THEN
      RAISE EXCEPTION 'INVALID_QTY: فرق التسوية لا يمكن أن يكون صفراً';
    END IF;
  ELSIF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QTY: الكمية يجب أن تكون أكبر من صفر';
  END IF;

  v_source := CASE v_type
    WHEN 'in' THEN 'manual_in'
    WHEN 'out' THEN 'manual_out'
    ELSE 'manual_adjustment'
  END;
  -- A form mints the key once. Retries share it. The item is the line, so one
  -- form can post several items without a second click creating a second movement.
  v_source_id := COALESCE(p_request_id, gen_random_uuid());
  v_line := CASE WHEN p_request_id IS NULL THEN '1' ELSE p_item_id::text END;

  RETURN public.post_inventory_movement(
    p_item_id, v_type, v_qty, v_source, v_source_id, v_line,
    btrim(p_reason), p_notes, p_performed_at, NULL, p_party, p_reference,
    'delta', false, NULL, NULL, 'warehouse_manual', NULL, p_override_reason,
    COALESCE(p_reference_type, 'manual_' || v_type), NULL, NULL,
    p_package_count, p_package_weight_kg, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_manual_inventory_movement(uuid, text, numeric, text, text, text, text, text, timestamptz, text, numeric, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_manual_inventory_movement(uuid, text, numeric, text, text, text, text, text, timestamptz, text, numeric, numeric, uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.set_inventory_item_stock(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.set_inventory_item_stock(
  p_item_id uuid,
  p_new_qty numeric,
  p_reason text,
  p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stock numeric;
  v_delta numeric;
BEGIN
  IF p_new_qty IS NULL OR p_new_qty < 0 THEN
    RAISE EXCEPTION 'INVALID_QTY: الرصيد الجديد لا يمكن أن يكون سالباً';
  END IF;
  SELECT stock INTO v_stock
    FROM public.inventory_items
   WHERE id = p_item_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود';
  END IF;
  v_delta := p_new_qty - COALESCE(v_stock, 0);
  IF v_delta = 0 THEN
    RETURN jsonb_build_object('status', 'unchanged', 'stock_before', v_stock, 'stock_after', v_stock);
  END IF;
  RETURN public.post_manual_inventory_movement(
    p_item_id, 'adjustment', v_delta, p_reason,
    NULL, NULL, NULL, 'stock_adjustment', NULL, NULL, NULL, NULL, p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_inventory_item_stock(uuid, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_inventory_item_stock(uuid, numeric, text, uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.inv_post_movement(uuid, uuid, text, numeric, numeric, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.inv_post_movement(
  p_item_id uuid,
  p_warehouse_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_unit_cost numeric DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id text DEFAULT NULL,
  p_module text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_override_negative boolean DEFAULT false,
  p_request_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_cost numeric;
  v_stock numeric;
  v_source text;
  v_mode text;
  v_posted jsonb;
  v_wh uuid;
  v_source_id uuid;
  v_line text;
BEGIN
  IF NOT public.can_post_inventory(v_uid) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;
  IF p_movement_type IN ('production_consumption','packaging_consumption') THEN
    SELECT unit_cost, stock INTO v_cost, v_stock FROM public.inventory_items WHERE id = p_item_id;
    IF v_cost = 0 AND v_stock > 0 THEN
      RAISE EXCEPTION 'BLOCKED_ZERO_COST';
    END IF;
  END IF;
  IF p_override_negative THEN
    IF NOT public.can_approve_inventory_override(v_uid) THEN
      RAISE EXCEPTION 'OVERRIDE_NOT_AUTHORIZED';
    END IF;
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
      RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED';
    END IF;
  END IF;

  v_source := CASE p_movement_type
    WHEN 'waste_loss' THEN 'waste'
    WHEN 'production_consumption' THEN 'production'
    WHEN 'finished_goods_receipt' THEN 'production'
    WHEN 'packaging_consumption' THEN 'packaging_consumption'
    WHEN 'purchase_receipt' THEN 'purchase'
    WHEN 'stock_out' THEN 'manual_out'
    WHEN 'out' THEN 'manual_out'
    WHEN 'transfer' THEN 'transfer_out'
    WHEN 'adjustment' THEN 'manual_adjustment'
    WHEN 'adjust' THEN 'manual_adjustment'
    ELSE 'manual_in'
  END;
  v_mode := CASE WHEN p_movement_type IN ('adjustment','adjust','reconciliation') THEN 'set' ELSE 'delta' END;
  SELECT warehouse_id INTO v_wh FROM public.inventory_items WHERE id = p_item_id;
  v_source_id := COALESCE(p_request_id, gen_random_uuid());
  v_line := CASE WHEN p_request_id IS NULL THEN '1' ELSE p_item_id::text END;

  PERFORM set_config('app.inventory_internal_post', 'on', true);
  v_posted := public.post_inventory_movement(
    p_item_id, p_movement_type, p_quantity, v_source, v_source_id, v_line,
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), v_source),
    NULL, now(), p_unit_cost, NULL, p_reference_id, v_mode, COALESCE(p_override_negative, false),
    COALESCE(p_warehouse_id, v_wh), NULL, COALESCE(p_module, 'inventory_engine'),
    NULL, NULL, p_reference_type, p_reference_id, NULL, NULL, NULL, NULL
  );
  v_id := (v_posted->>'id')::uuid;
  PERFORM set_config('app.inventory_internal_post', 'off', true);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.inv_post_movement(uuid, uuid, text, numeric, numeric, text, text, text, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_post_movement(uuid, uuid, text, numeric, numeric, text, text, text, text, boolean, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Freezer mirror is not a second stock quantity.
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_sublocation_items
  ADD COLUMN IF NOT EXISTS is_card_mirror boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inventory_sublocation_items.is_card_mirror IS
  'نسخة من رصيد الكارت (ثلاجة التجميد). لا تُجمع مع inventory_items.stock في أي تقرير أو مطابقة.';

INSERT INTO public.warehouse_sublocations (id, warehouse_id, code, name_ar)
SELECT '0fc8b6bd-5271-404d-a716-bd3e5df86859'::uuid,
       '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid,
       'FRIDGE',
       'ثلاجة التجميد'
 WHERE EXISTS (
   SELECT 1 FROM public.warehouses WHERE id = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid
 )
   AND NOT EXISTS (
     SELECT 1 FROM public.warehouse_sublocations
      WHERE warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid
        AND code = 'FRIDGE'
   )
ON CONFLICT (id) DO NOTHING;

UPDATE public.inventory_sublocation_items s
   SET is_card_mirror = true
  FROM public.warehouse_sublocations w
 WHERE w.id = s.sublocation_id
   AND w.code = 'FRIDGE'
   AND w.warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid;

CREATE OR REPLACE FUNCTION public.sync_main_stock_to_sublocations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_main_wh CONSTANT uuid := '5ec781b5-685b-4806-b59a-83a79ea5662c';
  v_freezer uuid;
  v_old_freezer_stock numeric := 0;
  v_new_stock numeric := COALESCE(NEW.stock, 0);
  v_delta numeric;
  v_note text;
BEGIN
  IF NEW.warehouse_id IS DISTINCT FROM v_main_wh OR NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_freezer
    FROM public.warehouse_sublocations
   WHERE warehouse_id = v_main_wh
     AND code = 'FRIDGE'
     AND COALESCE(is_active, true)
   ORDER BY (id = '0fc8b6bd-5271-404d-a716-bd3e5df86859'::uuid) DESC
   LIMIT 1;
  IF v_freezer IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(stock, 0)
    INTO v_old_freezer_stock
  FROM public.inventory_sublocation_items
  WHERE sublocation_id = v_freezer
    AND product_id = NEW.product_id;

  v_old_freezer_stock := COALESCE(v_old_freezer_stock, 0);
  v_delta := v_new_stock - v_old_freezer_stock;

  INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock, is_card_mirror)
  VALUES (v_freezer, NEW.product_id, v_new_stock, true)
  ON CONFLICT (sublocation_id, product_id)
  DO UPDATE SET stock = EXCLUDED.stock, is_card_mirror = true;

  IF v_delta <> 0 THEN
    v_note := 'مزامنة تلقائية مع الرصيد الفعلي للمخزن الرئيسي — مرآة ولا تُجمع مع الكارت';
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

CREATE OR REPLACE VIEW public.inventory_report_stock AS
SELECT i.id, i.warehouse_id, i.product_id, i.name, i.unit, i.stock, i.is_active
  FROM public.inventory_items i
 WHERE COALESCE(i.is_active, true);

COMMENT ON VIEW public.inventory_report_stock IS
  'رصيد التقارير والمطابقة. مرآة المواقع الفرعية غير داخلة.';

REVOKE ALL ON public.inventory_report_stock FROM PUBLIC, anon;
GRANT SELECT ON public.inventory_report_stock TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stock_report_totals(p_warehouse_id uuid)
RETURNS TABLE(card_kg numeric, mirror_kg numeric, daily_report_kg numeric, reconciliation_kg numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    round(COALESCE((
      SELECT SUM(i.stock) FROM public.inventory_items i
       WHERE i.warehouse_id = p_warehouse_id AND COALESCE(i.is_active, true)
    ), 0), 3) AS card_kg,
    round(COALESCE((
      SELECT SUM(s.stock)
        FROM public.inventory_sublocation_items s
        JOIN public.warehouse_sublocations w ON w.id = s.sublocation_id
       WHERE w.warehouse_id = p_warehouse_id
         AND s.is_card_mirror
    ), 0), 3) AS mirror_kg,
    round(COALESCE((
      SELECT SUM(r.stock) FROM public.inventory_report_stock r
       WHERE r.warehouse_id = p_warehouse_id
    ), 0), 3) AS daily_report_kg,
    round(COALESCE((
      SELECT SUM(i.stock) FROM public.inventory_items i
       WHERE i.warehouse_id = p_warehouse_id AND COALESCE(i.is_active, true)
    ), 0), 3) AS reconciliation_kg;
$$;

COMMENT ON FUNCTION public.stock_report_totals(uuid) IS
  'daily_report_kg وreconciliation_kg يساويان رصيد الكارت فقط. mirror_kg للعرض ولا يُضاف.';

REVOKE ALL ON FUNCTION public.stock_report_totals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_report_totals(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Stale functions: raise before any stock write, then revoke from users.
-- redirect_merged_item_stock stays a no-op for ordinary cards. A full raise
-- would stop every inventory_items update, including the ledger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redirect_merged_item_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_canonical uuid;
BEGIN
  SELECT canonical_item_id INTO v_canonical
    FROM public.inventory_item_merge_log
   WHERE source_item_id = NEW.id
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_canonical IS NULL OR v_canonical = NEW.id THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم بطاقة المنتج الأساسية ودفتر المخزون';
END;
$$;

REVOKE ALL ON FUNCTION public.redirect_merged_item_stock() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_meat_production_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم فواتير تصنيع مصنع اللحوم واعتمادها عبر دفتر المخزون';
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_meat_production_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم إلغاء فاتورة التصنيع الحية عبر دفتر المخزون';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_meat_production_item() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_meat_production_item() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_meat_factory_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم فواتير تصنيع مصنع اللحوم واعتمادها عبر دفتر المخزون';
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_meat_manufacturing(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم فواتير تصنيع مصنع اللحوم واعتمادها عبر دفتر المخزون';
END;
$$;

CREATE OR REPLACE FUNCTION public.post_mf_raw_purchase(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم اعتماد مشتريات المصنع approve_meat_purchase';
END;
$$;

CREATE OR REPLACE FUNCTION public.post_mf_pack_purchase(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم شراء التغليف في مخزن أدوات التغليف';
END;
$$;

CREATE OR REPLACE FUNCTION public.post_mf_manufacturing(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم فواتير تصنيع مصنع اللحوم واعتمادها عبر دفتر المخزون';
END;
$$;

CREATE OR REPLACE FUNCTION public.post_mf_sale(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم صرف كروت المخزون الحية';
END;
$$;

CREATE OR REPLACE FUNCTION public.post_mf_return(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم مرتجع كروت المخزون الحية';
END;
$$;

CREATE OR REPLACE FUNCTION public.post_mf_transfer(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم تحويل الإنتاج الحي واستلامه على بطاقة المنتج';
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_mf_transfer(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم رفض تحويل الإنتاج الحي reject_meat_production_transfer';
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_meat_sale(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم صرف كروت المخزون الحية';
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_meat_sales_return(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم مرتجع كروت المخزون الحية';
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_meat_sales_return(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'هذه الدالة موقوفة، استخدم مرتجع كروت المخزون الحية';
END;
$$;

REVOKE ALL ON FUNCTION public.approve_meat_factory_batch(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_meat_manufacturing(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_mf_raw_purchase(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_mf_pack_purchase(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_mf_manufacturing(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_mf_sale(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_mf_return(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_mf_transfer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_mf_transfer(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_meat_sale(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_meat_sales_return(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_meat_sales_return(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Old mf receipt never opens a card by item code.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_mf_transfer(p_id uuid, p_notes text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  inv RECORD;
  ln RECORD;
  dest_item_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_role(v_uid,'general_manager')
    OR public.has_role(v_uid,'executive_manager')
    OR public.has_role(v_uid,'warehouse_supervisor')
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية اعتماد الوارد';
  END IF;

  SELECT * INTO inv FROM mf_transfers WHERE id = p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'أمر نقل غير موجود'; END IF;
  IF inv.status <> 'awaiting_receipt' THEN
    RAISE EXCEPTION 'أمر النقل ليس بانتظار الاستلام (الحالة: %)', inv.status;
  END IF;

  FOR ln IN
    SELECT l.*, f.name_ar AS fname, f.unit AS funit, f.code AS fcode
    FROM mf_transfer_lines l
    JOIN meat_finished_inventory f ON f.id = l.finished_id
    WHERE l.transfer_id = p_id
  LOOP
    SELECT ii.id INTO dest_item_id
      FROM public.inventory_items ii
     WHERE ii.warehouse_id = inv.destination_warehouse_id
       AND ii.product_id IS NOT NULL
       AND COALESCE(ii.is_active, true)
       AND (
         ii.item_code = ln.fcode
         OR public.normalize_ar_name(ii.name) = public.normalize_ar_name(ln.fname)
       )
     ORDER BY CASE WHEN ii.item_code = ln.fcode THEN 0 ELSE 1 END, ii.created_at
     LIMIT 1;
    IF dest_item_id IS NULL THEN
      RAISE EXCEPTION 'CANONICAL_CARD_REQUIRED: لا توجد بطاقة مربوطة في مخزن الوجهة للصنف «%». لن تُفتح بطاقة يتيمة.', ln.fname;
    END IF;

    PERFORM set_config('app.inventory_internal_post', 'on', true);
    PERFORM public.post_inventory_movement(
      dest_item_id, 'in', ln.qty, 'transfer_in', inv.id, ln.id::text,
      COALESCE(p_notes, 'استلام معتمد من مصنع اللحوم'),
      COALESCE(p_notes, 'استلام معتمد من مصنع اللحوم'),
      now(), COALESCE(ln.unit_cost, 0), 'مصنع اللحوم', inv.transfer_no, 'delta', false,
      inv.destination_warehouse_id, NULL, 'meat', NULL, NULL,
      'mf_transfers', inv.id::text, NULL, NULL, NULL, NULL
    );
    PERFORM set_config('app.inventory_internal_post', 'off', true);
  END LOOP;

  UPDATE mf_transfers
     SET status = 'posted', posted_at = now(), posted_by = v_uid,
         received_at = now(), received_by = v_uid,
         notes = COALESCE(p_notes, notes), updated_at = now()
   WHERE id = p_id;
END
$function$;

-- ---------------------------------------------------------------------------
-- 6. Finished factory stock is history. Live finished goods are inventory cards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_stale_stock_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
BEGIN
  IF TG_TABLE_NAME = 'meat_factory_finished_items' THEN
    v_before := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.current_stock END;
    v_after := NEW.current_stock;
  ELSE
    v_before := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.stock END;
    v_after := NEW.stock;
  END IF;
  IF v_before IS NOT DISTINCT FROM v_after THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND COALESCE(v_after, 0) = 0 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'STALE_STORE_READONLY: % لم يعد مخزنًا حيًا. الرصيد في دفتر المخزن أو خامات المصنع. البيانات تبقى للقراءة.', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_stale_mf_finished_items ON public.meat_factory_finished_items;
CREATE TRIGGER trg_00_stale_mf_finished_items
  BEFORE INSERT OR UPDATE OF current_stock ON public.meat_factory_finished_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_stale_stock_write();

CREATE OR REPLACE FUNCTION public.apply_meat_stocktake(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_s RECORD; v_line RECORD; v_dir TEXT; v_qty NUMERIC; v_cost NUMERIC;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
      OR has_role(auth.uid(),'meat_factory_manager')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  SELECT * INTO v_s FROM meat_factory_stocktaking WHERE id=p_id FOR UPDATE;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'الجرد غير موجود'; END IF;
  IF v_s.status='approved' THEN RAISE EXCEPTION 'الجرد معتمد بالفعل'; END IF;
  IF COALESCE(v_s.item_kind, '') <> 'raw' THEN
    RAISE EXCEPTION 'STALE_STORE_READONLY: جرد تام المصنع القديم موقوف. رصيد المنتج التام على بطاقات المخزون.';
  END IF;

  FOR v_line IN SELECT * FROM meat_factory_stocktaking_lines WHERE stocktake_id=p_id LOOP
    IF v_line.diff_qty = 0 THEN CONTINUE; END IF;
    v_dir := CASE WHEN v_line.diff_qty>0 THEN 'IN' ELSE 'OUT' END;
    v_qty := ABS(v_line.diff_qty);
    SELECT avg_cost INTO v_cost FROM meat_factory_raw_items WHERE id=v_line.item_id;
    PERFORM public.post_meat_raw_movement(
      v_line.item_id, v_dir, v_qty, COALESCE(v_cost,0),
      'تسوية جرد', 'meat_factory_stocktaking', p_id,
      'raw', 'set', v_line.actual_qty, NULL, v_line.item_name
    );
  END LOOP;

  UPDATE meat_factory_stocktaking SET status='approved', approved_at=now(), approved_by=auth.uid() WHERE id=p_id;
  RETURN p_id;
END
$function$;

-- ---------------------------------------------------------------------------
-- 7. One custody return line per custody + order + item.
-- ---------------------------------------------------------------------------
-- Historical return lines may already repeat. Only lines this function marks
-- ledger_keyed are unique, so apply does not fail and old rows are not merged.
ALTER TABLE public.courier_goods_custody_lines
  ADD COLUMN IF NOT EXISTS ledger_keyed boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS courier_return_line_once
  ON public.courier_goods_custody_lines (custody_id, order_id, inventory_item_id)
  WHERE line_type = 'return' AND inventory_item_id IS NOT NULL AND ledger_keyed;

CREATE OR REPLACE FUNCTION public.record_courier_return(p_assignment_id uuid, p_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_asn RECORD;
  v_order RECORD;
  v_courier text;
  v_custody_id uuid;
  v_reference text;
  v_existing int;
  v_line RECORD;
  v_mov_id uuid;
  v_returned_lines int := 0;
  v_total_value numeric := 0;
  v_inserted int;
BEGIN
  IF p_assignment_id IS NULL THEN RAISE EXCEPTION 'assignment_id is required'; END IF;

  SELECT a.id, a.custody_id, a.order_id, a.courier_name, a.status
    INTO v_asn
  FROM public.courier_order_assignments a
  WHERE a.id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التعيين غير موجود'; END IF;
  IF v_asn.status IN ('fully_returned','cancelled','completed') THEN
    RAISE EXCEPTION 'لا يمكن تسجيل مرتجع — الحالة الحالية: %', v_asn.status;
  END IF;

  v_courier := v_asn.courier_name;
  v_custody_id := v_asn.custody_id;

  SELECT o.id, o.order_number, o.customer_id, o.total
    INTO v_order
  FROM public.orders o WHERE o.id = v_asn.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الأوردر غير موجود'; END IF;

  v_reference := 'RET-' || COALESCE(NULLIF(p_idempotency_key,''),
                  to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS') || '-' || substr(v_asn.id::text,1,6));

  SELECT count(*) INTO v_existing
  FROM public.inventory_movements WHERE reference = v_reference;
  IF v_existing > 0 THEN
    RETURN jsonb_build_object('reference', v_reference, 'idempotent_hit', true);
  END IF;

  FOR v_line IN
    SELECT l.id, l.inventory_item_id, l.inventory_movement_id, l.product_name,
           l.quantity, l.unit, l.unit_price, l.total_value, l.customer_id, l.customer_name
    FROM public.courier_goods_custody_lines l
    WHERE l.custody_id = v_custody_id
      AND l.order_id = v_asn.order_id
      AND l.line_type = 'issue'
  LOOP
    PERFORM set_config('app.inventory_internal_post', 'on', true);
    v_mov_id := (public.post_inventory_movement(
      v_line.inventory_item_id, 'sales_return', v_line.quantity,
      'order_return', v_order.id, v_line.inventory_item_id::text,
      COALESCE(NULLIF(p_reason,''), 'مرتجع كامل من العميل'),
      trim(coalesce(v_order.order_number,'') || ' — مرتجع مندوب'),
      now(), 0, 'مرتجع من المندوب — ' || COALESCE(v_courier, ''), v_reference,
      'delta', false,
      NULL, NULL, 'courier_distribution', NULL, NULL,
      'courier_return', p_assignment_id::text, NULL, NULL, NULL, NULL
    )->>'id')::uuid;
    PERFORM set_config('app.inventory_internal_post', 'off', true);

    INSERT INTO public.courier_goods_custody_lines(
      custody_id, line_type, customer_id, customer_name, order_id,
      inventory_item_id, inventory_movement_id, product_name,
      quantity, unit, unit_price, total_value, cash_collected,
      performed_at, performed_by, notes, ledger_keyed
    ) VALUES (
      v_custody_id, 'return', v_line.customer_id, v_line.customer_name, v_asn.order_id,
      v_line.inventory_item_id, v_mov_id, v_line.product_name,
      v_line.quantity, v_line.unit, v_line.unit_price, v_line.total_value, 0,
      now(), v_user,
      'مرتجع — ' || v_reference || COALESCE(' | ' || NULLIF(p_reason,''), '') || COALESCE(' | ' || NULLIF(p_notes,''), ''),
      true
    )
    ON CONFLICT (custody_id, order_id, inventory_item_id)
      WHERE line_type = 'return' AND inventory_item_id IS NOT NULL AND ledger_keyed
    DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted > 0 THEN
      v_returned_lines := v_returned_lines + 1;
      v_total_value := v_total_value + COALESCE(v_line.total_value, 0);
    END IF;
  END LOOP;

  UPDATE public.courier_order_assignments
     SET status = 'fully_returned',
         returned_at = now(),
         notes = COALESCE(NULLIF(p_notes,''), notes),
         updated_at = now()
   WHERE id = p_assignment_id;

  INSERT INTO public.pc_order_tracking(order_id, courier_status, last_updated_by)
  VALUES (v_order.id, 'returned_to_warehouse'::pc_courier_status, v_user)
  ON CONFLICT (order_id) DO UPDATE SET
    courier_status = EXCLUDED.courier_status,
    last_updated_by = EXCLUDED.last_updated_by,
    updated_at = now();

  UPDATE public.orders
     SET status = 'returned',
         updated_at = now()
   WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'reference', v_reference,
    'returned_lines', v_returned_lines,
    'total_value', v_total_value,
    'idempotent_hit', false
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Old factory packaging deductions return once to مخزن التغليف.
-- ---------------------------------------------------------------------------
DO $patch_old_pack$
DECLARE
  def text;
  old_decl text := 'v_before jsonb; v_orig uuid; v_pack_mov uuid;';
  new_decl text := 'v_before jsonb; v_orig uuid; v_pack_mov uuid; v_pack_card uuid;';
  old_skip text := 'IF COALESCE(v_item.kind, v_move.item_kind) = ''packaging'' THEN CONTINUE; END IF;';
  new_skip text := $body$
    IF COALESCE(v_item.kind, v_move.item_kind) = 'packaging' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.inventory_movements mv
         WHERE mv.source_type = 'packaging_consumption'
           AND mv.source_id = p_invoice_id
           AND mv.source_line_id = v_move.item_id::text
           AND COALESCE(mv.approval_status, 'posted') = 'posted'
      ) THEN
        v_pack_card := public.resolve_packaging_card(
          v_move.item_id, COALESCE(v_item.name, v_move.item_name), true
        );
        IF v_pack_card IS NULL THEN
          RAISE EXCEPTION 'تغليف غير مربوط بمخزن التغليف: %. اربط الصنف قبل إلغاء الفاتورة القديمة.',
            COALESCE(v_item.name, v_move.item_name);
        END IF;
        PERFORM set_config('app.inventory_internal_post', 'on', true);
        PERFORM public.post_inventory_movement(
          v_pack_card, 'in', v_move.quantity, 'reversal',
          p_invoice_id, 'pkg:' || v_move.id::text,
          p_reason,
          'إرجاع تغليف فاتورة قديمة إلى مخزن التغليف',
          now(), COALESCE(v_move.unit_cost, 0), 'مصنع اللحوم', v_inv.invoice_no,
          'delta', false, public.packaging_warehouse_id(), NULL, 'meat', NULL, NULL,
          'manufacturing_cancel', p_invoice_id::text, NULL, NULL, NULL, NULL
        );
        PERFORM set_config('app.inventory_internal_post', 'off', true);
      END IF;
      CONTINUE;
    END IF;
  $body$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'cancel_meat_manufacturing_invoice'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_invoice_id%';
  IF def IS NULL THEN
    RAISE EXCEPTION 'cancel_meat_manufacturing_invoice is missing';
  END IF;
  IF def NOT LIKE '%pkg:%' THEN
    IF position(old_decl IN def) = 0 OR position(old_skip IN def) = 0 THEN
      RAISE EXCEPTION 'cancel packaging anchors moved';
    END IF;
    def := replace(def, old_decl, new_decl);
    def := replace(def, old_skip, new_skip);
    IF right(btrim(def), 1) <> ';' THEN
      def := def || ';';
    END IF;
    EXECUTE def;
  END IF;
END
$patch_old_pack$;

-- ---------------------------------------------------------------------------
-- 9. Bulk cap exemption is the database role, not a client column.
-- Zodex and Bosta update one order per statement and run as service_role.
-- The condition below is what lets a sync pass more than 20 in one statement.
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.enforce_bulk_delivery_cap() IS
  'يتجاوز الحد إذا current_user IN (postgres, service_role, supabase_admin) أو bulk_delivery_cap_role_bypass() للمدير العام/التنفيذي. زودكس (sync-zodex-deliveries) وبوسطة (process-bostta-delivery) يحدّثان طلباً واحداً لكل جملة بمعرّف الطلب، وخصم المخزون مرة عبر مفتاح سطر الطلب.';

CREATE OR REPLACE FUNCTION public.closed_loop_open_items()
RETURNS TABLE(item text)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULL::text WHERE false
$$;

REVOKE ALL ON FUNCTION public.closed_loop_open_items() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.closed_loop_open_items() TO authenticated, service_role;
