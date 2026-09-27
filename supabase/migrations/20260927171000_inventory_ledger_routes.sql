-- Route the stock documents through post_inventory_movement.
-- Order deduction uses orders.source_warehouse_id for every warehouse
-- (main, Agouza, Carrefour, Healthy Taste). NULL is an error, not a skip.
-- One movement per order line. Unlinked products are failed lines, not silent skips.
-- This file does not change order totals, offer-box shipping, or created_by.

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
  p_package_weight_kg numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_type text := lower(btrim(COALESCE(p_movement_type, '')));
  v_qty numeric := p_quantity;
  v_source text;
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

  RETURN public.post_inventory_movement(
    p_item_id, v_type, v_qty, v_source, gen_random_uuid(), '1',
    btrim(p_reason), p_notes, p_performed_at, NULL, p_party, p_reference,
    'delta', false, NULL, NULL, 'warehouse_manual', NULL, p_override_reason,
    COALESCE(p_reference_type, 'manual_' || v_type), NULL, NULL,
    p_package_count, p_package_weight_kg, NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._dispatch_order_stock_core(
  p_order_id uuid, p_actor uuid DEFAULT NULL, p_note text DEFAULT NULL, p_commit_reservations boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order      record;
  v_item       record;
  v_canonical  uuid;
  v_cost       numeric;
  v_avail      numeric;
  v_stock      numeric;
  v_reserved   numeric;
  v_blocked    numeric;
  v_failures   int := 0;
  v_movements  int := 0;
  v_total_qty  numeric := 0;
  v_resv       int := 0;
  v_by         text := COALESCE(p_actor::text, 'system:auto_dispatch');
  v_lock       timestamptz;
  v_reason     text;
  v_details    jsonb := '[]'::jsonb;
  v_posted     jsonb;
BEGIN
  SELECT id, order_number, shipping_company, source_warehouse_id, stock_status, status, delivered_at
    INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND — الأوردر غير موجود';
  END IF;

  IF v_order.stock_status = 'skipped_period_lock' THEN
    RETURN jsonb_build_object('status','skipped_period_lock','order_id',p_order_id,'order_number',v_order.order_number);
  END IF;

  IF v_order.stock_status = 'dispatched' THEN
    PERFORM public._resolve_order_stock_dispatch_failures(p_order_id, v_by);
    RETURN jsonb_build_object('status','already_dispatched','order_id',p_order_id,'order_number',v_order.order_number);
  END IF;

  IF v_order.source_warehouse_id IS NOT NULL
     AND NOT public._order_auto_dispatch_allowed(v_order.source_warehouse_id, v_order.delivered_at) THEN
    RETURN jsonb_build_object('status','manual_warehouse_skipped','order_id',p_order_id,
      'message','المخزن الرئيسي: الأوردر اتسلّم قبل تفعيل الخصم التلقائي — لا يتم الخصم بأثر رجعي');
  END IF;

  v_lock := public.warehouse_period_locked_until(v_order.source_warehouse_id);
  IF v_lock IS NOT NULL AND v_order.delivered_at IS NOT NULL AND v_order.delivered_at < v_lock THEN
    UPDATE public.orders SET stock_status = 'skipped_period_lock' WHERE id = p_order_id;
    INSERT INTO public.order_period_lock_skips(order_id, warehouse_id, delivered_at, locked_until, note)
    SELECT p_order_id, v_order.source_warehouse_id, v_order.delivered_at, v_lock,
           'تسليم قبل قفل الجرد — بدون خصم حتى لا يُخصم المخزون مرتين'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.order_period_lock_skips s WHERE s.order_id = p_order_id
     );
    PERFORM public._resolve_order_stock_dispatch_failures(p_order_id, 'system:period_lock');
    RETURN jsonb_build_object('status','skipped_period_lock','order_id',p_order_id,
      'order_number', v_order.order_number, 'locked_until', v_lock);
  END IF;

  IF v_order.source_warehouse_id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'SOURCE_WAREHOUSE_UNRESOLVED — لم يتم تحديد المخزن المصدر للأوردر',
      DETAIL  = jsonb_build_array(jsonb_build_object('code','SOURCE_WAREHOUSE_UNRESOLVED'))::text;
  END IF;

  -- Delivery is the authority for every warehouse. The delivering user may not
  -- hold a stock-posting role. The flag is local to this transaction.
  PERFORM set_config('app.inventory_internal_post', 'on', true);

  FOR v_item IN
    SELECT oi.id AS order_item_id,
           oi.product_id,
           btrim(COALESCE(p.name, oi.product_name, '')) AS pname,
           oi.quantity::numeric AS qty,
           (oi.product_id IS NULL OR p.id IS NULL) AS missing_product,
           (p.id IS NOT NULL AND p.is_active IS NOT TRUE) AS inactive,
           (p.id IS NOT NULL AND (p.barcode IS NULL OR length(btrim(COALESCE(p.barcode, ''))) = 0)) AS no_barcode
      FROM public.order_items oi
      LEFT JOIN public.products p ON p.id = oi.product_id
     WHERE oi.order_id = p_order_id
       AND COALESCE(oi.quantity, 0) > 0
  LOOP
    v_reason := NULL;
    v_canonical := NULL;

    IF v_item.missing_product THEN
      v_reason := format('البند "%s" غير مربوط بمنتج', v_item.pname);
    ELSIF v_item.inactive THEN
      v_reason := format('المنتج "%s" غير نشط', v_item.pname);
    ELSIF v_item.no_barcode THEN
      v_reason := format('المنتج "%s" بدون باركود', v_item.pname);
    ELSE
      SELECT i.id, i.stock, COALESCE(i.reserved_qty, 0), COALESCE(i.blocked_qty, 0), COALESCE(i.unit_cost, 0)
        INTO v_canonical, v_stock, v_reserved, v_blocked, v_cost
        FROM public.inventory_items i
       WHERE i.product_id = v_item.product_id
         AND i.warehouse_id = v_order.source_warehouse_id
         AND COALESCE(i.is_active, true)
       ORDER BY i.id
       LIMIT 1
       FOR UPDATE;

      IF v_canonical IS NULL THEN
        v_reason := format('لا توجد بطاقة مخزون مربوطة بالمنتج "%s" في المخزن', v_item.pname);
      ELSE
        v_avail := COALESCE(v_stock, 0) - v_reserved - v_blocked;
        IF v_avail < v_item.qty AND NOT EXISTS (
          SELECT 1 FROM public.inventory_movements m
           WHERE m.source_type = 'order_delivery'
             AND m.source_id = p_order_id
             AND m.source_line_id = v_item.order_item_id::text
        ) THEN
          v_reason := format('رصيد "%s" غير كافٍ (المطلوب %s، المتاح %s)', v_item.pname, v_item.qty, v_avail);
        END IF;
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_failures := v_failures + 1;
      v_details := v_details || jsonb_build_object(
        'order_item_id', v_item.order_item_id,
        'product_id', v_item.product_id,
        'product_name', v_item.pname,
        'reason', v_reason
      );
      INSERT INTO public.order_deduction_lines(order_id, product_id, order_item_id, inventory_item_id, quantity, status, reason)
      VALUES (p_order_id, v_item.product_id, v_item.order_item_id, v_canonical, v_item.qty, 'failed', v_reason)
      ON CONFLICT (order_id, order_item_id) WHERE order_item_id IS NOT NULL DO UPDATE
        SET status = 'failed',
            reason = EXCLUDED.reason,
            inventory_item_id = EXCLUDED.inventory_item_id,
            quantity = EXCLUDED.quantity,
            product_id = EXCLUDED.product_id;
      CONTINUE;
    END IF;

    v_posted := public.post_inventory_movement(
      v_canonical, 'sales_dispatch', v_item.qty,
      'order_delivery', p_order_id, v_item.order_item_id::text,
      'صرف مبيعات',
      concat(
        'صرف تلقائي للأوردر ', v_order.order_number,
        ' canonical_item=', v_canonical::text,
        CASE WHEN p_note IS NOT NULL THEN ' — ' || p_note ELSE '' END
      ),
      COALESCE(v_order.delivered_at, now()),
      COALESCE(v_cost, 0),
      COALESCE(v_order.shipping_company, '—'),
      v_order.order_number,
      'delta', false,
      v_order.source_warehouse_id,
      v_item.product_id,
      'sales',
      NULL, NULL,
      'order', p_order_id::text,
      NULL, NULL, NULL,
      v_item.order_item_id
    );

    INSERT INTO public.order_deduction_lines(order_id, product_id, order_item_id, inventory_item_id, quantity, status, reason)
    VALUES (p_order_id, v_item.product_id, v_item.order_item_id, v_canonical, v_item.qty, 'posted', NULL)
    ON CONFLICT (order_id, order_item_id) WHERE order_item_id IS NOT NULL DO UPDATE
      SET status = 'posted',
          reason = NULL,
          inventory_item_id = EXCLUDED.inventory_item_id,
          quantity = EXCLUDED.quantity,
          product_id = EXCLUDED.product_id;

    v_movements := v_movements + 1;
    v_total_qty := v_total_qty + v_item.qty;
  END LOOP;

  IF v_failures > 0 THEN
    BEGIN
      PERFORM public._log_order_stock_dispatch_failure(
        p_order_id,
        'تعذّر خصم بعض بنود الأوردر',
        v_details::text,
        true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'order stock failure notification skipped: %', SQLERRM;
    END;
    PERFORM set_config('app.inventory_internal_post', 'off', true);
    RETURN jsonb_build_object(
      'status','partial_or_failed','order_id',p_order_id,'order_number',v_order.order_number,
      'movements', v_movements, 'failures', v_failures, 'details', v_details
    );
  END IF;

  UPDATE public.orders SET stock_status = 'dispatched' WHERE id = p_order_id;

  IF p_commit_reservations THEN
    v_resv := public._commit_order_reservations_after_dispatch(p_order_id, p_actor, 'dispatch_order_stock');
  END IF;

  UPDATE public.agouza_stock_reservations
     SET status = 'committed', committed_at = now(), committed_by = COALESCE(p_actor, auth.uid())
   WHERE order_id = p_order_id AND status = 'active';

  PERFORM public._resolve_order_stock_dispatch_failures(p_order_id, v_by);
  PERFORM set_config('app.inventory_internal_post', 'off', true);

  RETURN jsonb_build_object('status','dispatched','order_id',p_order_id,'order_number',v_order.order_number,
    'movements', v_movements, 'total_qty', v_total_qty, 'reservations_committed', v_resv);
END;
$function$;

CREATE OR REPLACE FUNCTION public._return_order_dispatched_stock(p_order_id uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r    record;
  v_ii record;
  v_n  integer := 0;
BEGIN
  PERFORM set_config('app.inventory_internal_post', 'on', true);
  FOR r IN SELECT * FROM public._order_net_dispatched_items(p_order_id) LOOP
    SELECT id, warehouse_id, product_id, unit_cost, module INTO v_ii
      FROM public.inventory_items WHERE id = r.item_id FOR UPDATE;
    IF v_ii.id IS NULL THEN CONTINUE; END IF;

    PERFORM public.post_inventory_movement(
      v_ii.id, 'sales_return', r.net_qty,
      'order_return', p_order_id, v_ii.id::text,
      COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'مرتجع أوردر'),
      'إرجاع صرف الأوردر',
      now(), COALESCE(v_ii.unit_cost, 0), NULL, p_order_id::text,
      'delta', false,
      COALESCE(r.warehouse_id, v_ii.warehouse_id),
      v_ii.product_id, COALESCE(v_ii.module, 'sales'),
      NULL, NULL, 'order', p_order_id::text, NULL, NULL, NULL, NULL
    );
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('app.inventory_internal_post', 'off', true);
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_stocktaking_session(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.stocktaking_sessions%ROWTYPE;
  v_line RECORD;
  v_delta numeric;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::public.app_role)
    OR public.has_role(v_uid, 'executive_manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: اعتماد الجرد متاح فقط للمدير العام أو المدير التنفيذي';
  END IF;

  SELECT * INTO v_session FROM public.stocktaking_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'SESSION_NOT_DRAFT'; END IF;

  UPDATE public.stocktaking_sessions s
     SET total_increase = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id AND diff > 0), 0),
         total_decrease = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id AND diff < 0), 0),
         net_value      = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id), 0)
   WHERE s.id = p_session_id;

  FOR v_line IN
    SELECT l.*, i.stock AS current_stock
      FROM public.stocktaking_lines l
      JOIN public.inventory_items i ON i.id = l.item_id
     WHERE l.session_id = p_session_id
       AND (l.actual_qty - i.stock) <> 0
     FOR UPDATE OF i
  LOOP
    v_delta := v_line.actual_qty - v_line.current_stock;
    PERFORM public.post_inventory_movement(
      v_line.item_id, 'adjustment', v_delta, 'stocktake', p_session_id, v_line.item_id::text,
      v_line.reason,
      'تسوية جرد جلسة ' || v_session.session_no
        || ': قبل=' || v_line.current_stock
        || ' بعد=' || v_line.actual_qty
        || ' فرق=' || v_delta
        || ' لقطة_الجرد=' || v_line.system_qty,
      now(), COALESCE(v_line.unit_cost, 0), NULL, 'stocktaking_' || v_session.session_no,
      'delta', false, v_session.warehouse_id, NULL, 'warehouse',
      NULL, NULL, 'stocktaking', p_session_id::text, NULL, NULL, NULL, NULL
    );
  END LOOP;

  UPDATE public.stocktaking_sessions
     SET status = 'approved', approved_by = v_uid, approved_at = now(),
         reference_id = 'stocktaking_' || v_session.session_no
   WHERE id = p_session_id;

  RETURN p_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_stock_adjustment(
  p_item_id uuid,
  p_actual_qty numeric,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item public.inventory_items%ROWTYPE;
  v_posted jsonb;
  v_diff numeric;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::public.app_role)
    OR public.has_role(v_uid, 'executive_manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: فقط المدير العام أو المدير التنفيذي يعتمد التسويات';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: السبب مطلوب (٣ حروف على الأقل)';
  END IF;
  IF p_actual_qty IS NULL OR p_actual_qty < 0 THEN
    RAISE EXCEPTION 'INVALID_QTY: الكمية الفعلية غير صحيحة';
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_diff := p_actual_qty - v_item.stock;
  IF v_diff = 0 THEN
    RAISE EXCEPTION 'لا يوجد فرق بين الرصيد الحالي والكمية المطلوبة';
  END IF;

  v_posted := public.post_inventory_movement(
    p_item_id, 'adjustment', v_diff, 'manual_adjustment', gen_random_uuid(), '1',
    btrim(p_reason),
    'تسوية جرد: قبل=' || v_item.stock || ' بعد=' || p_actual_qty || ' فرق=' || v_diff,
    now(), v_item.unit_cost, NULL, NULL, 'delta', false,
    v_item.warehouse_id, v_item.product_id, 'warehouse',
    NULL, NULL, 'stock_adjustment', NULL, NULL, NULL, NULL, NULL
  );
  RETURN (v_posted->>'id')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_warehouse_opening_balance(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ob public.warehouse_opening_balances%ROWTYPE;
  v_existing uuid;
  v_posted jsonb;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::public.app_role)
    OR public.has_role(v_uid, 'executive_manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: فقط المدير العام أو المدير التنفيذي يعتمد الرصيد الافتتاحي';
  END IF;

  SELECT * INTO v_ob FROM public.warehouse_opening_balances WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_ob.status = 'approved' THEN RETURN v_ob.posted_movement_id; END IF;

  SELECT id INTO v_existing FROM public.inventory_movements
   WHERE source_type = 'opening_balance' AND source_id = p_id AND source_line_id = '1'
   LIMIT 1;

  IF v_existing IS NULL THEN
    v_posted := public.post_inventory_movement(
      v_ob.item_id, 'opening_balance', v_ob.qty, 'opening_balance', p_id, '1',
      'رصيد افتتاحي', COALESCE(v_ob.notes, '') || ' [opening_balance approved]',
      COALESCE(v_ob.opened_at, now()), COALESCE(v_ob.unit_cost, 0), 'رصيد افتتاحي', NULL,
      'set', false, v_ob.warehouse_id, v_ob.product_id, 'warehouse',
      NULL, NULL, 'opening_balance', p_id::text, NULL, NULL, NULL, NULL
    );
    v_existing := (v_posted->>'id')::uuid;
  END IF;

  UPDATE public.warehouse_opening_balances
     SET status = 'approved', approved_by = v_uid, approved_at = now(),
         posted_movement_id = v_existing, updated_at = now()
   WHERE id = p_id;

  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_and_send_transfer(
  p_source_warehouse_id uuid, p_destination_warehouse_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_transfer_id uuid; v_transfer_no text; v_line jsonb;
  v_src_item public.inventory_items%ROWTYPE;
  v_qty numeric; v_src_mv_id uuid; v_lines_created int := 0; v_src_wh_name text; v_party text; v_dest_id uuid;
  v_line_id uuid; v_posted jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (
    public.has_role(v_uid,'general_manager'::public.app_role)
    OR public.has_role(v_uid,'executive_manager'::public.app_role)
    OR public.has_role(v_uid,'warehouse_supervisor'::public.app_role)
    OR public.has_role(v_uid,'meat_factory_manager'::public.app_role)
    OR public.has_role(v_uid,'production_manager'::public.app_role)
    OR public.inventory_has_warehouse_capability(v_uid, p_source_warehouse_id, 'send')
  ) THEN RAISE EXCEPTION 'insufficient_privilege'; END IF;
  IF p_source_warehouse_id = p_destination_warehouse_id THEN RAISE EXCEPTION 'same_warehouse'; END IF;
  IF jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'no_lines'; END IF;
  SELECT name INTO v_src_wh_name FROM public.warehouses WHERE id = p_source_warehouse_id;
  v_party := CASE
    WHEN v_src_wh_name ILIKE '%مصنع اللحوم%' THEN 'مصنع اللحوم'
    WHEN v_src_wh_name ILIKE '%مصنع العلف%' THEN 'مصنع العلف'
    WHEN v_src_wh_name ILIKE '%مجزر%' THEN 'المجزر'
    ELSE v_src_wh_name
  END;
  v_transfer_no := public.gen_transfer_no();
  INSERT INTO public.warehouse_transfers(
    transfer_no, source_warehouse_id, destination_warehouse_id, status,
    created_by, sent_by, sent_at, notes, legacy_dual_post, audit_log
  ) VALUES (
    v_transfer_no, p_source_warehouse_id, p_destination_warehouse_id, 'pending_receipt',
    v_uid, v_uid, now(), p_notes, false,
    jsonb_build_array(jsonb_build_object('event','created_and_sent','by',v_uid,'at',now()))
  ) RETURNING id INTO v_transfer_id;

  PERFORM set_config('app.inventory_internal_post', 'on', true);

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (v_line->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO v_src_item FROM public.inventory_items
     WHERE id = (v_line->>'source_item_id')::uuid AND warehouse_id = p_source_warehouse_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'source_item_not_found: %', v_line->>'source_item_id'; END IF;
    v_dest_id := public.resolve_inventory_transfer_destination(v_src_item.id, p_destination_warehouse_id);
    IF v_dest_id IS NULL THEN
      IF p_destination_warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid AND v_party = 'مصنع اللحوم' THEN
        RAISE EXCEPTION 'destination_item_mapping_required: %', v_src_item.name;
      END IF;
      INSERT INTO public.inventory_items(
        warehouse_id, name, category, sku, unit, stock, low_stock_threshold, unit_cost, item_code, product_id, module
      ) VALUES (
        p_destination_warehouse_id, v_src_item.name, v_src_item.category, v_src_item.sku, v_src_item.unit,
        0, v_src_item.low_stock_threshold, v_src_item.unit_cost, v_src_item.item_code, v_src_item.product_id, v_src_item.module
      ) RETURNING id INTO v_dest_id;
    END IF;

    INSERT INTO public.warehouse_transfer_items(
      transfer_id, source_item_id, destination_item_id, item_name, unit,
      requested_qty, sent_qty, unit_cost, total_cost, source_movement_id, destination_movement_id, line_status
    ) VALUES (
      v_transfer_id, v_src_item.id, v_dest_id, v_src_item.name, v_src_item.unit,
      v_qty, v_qty, v_src_item.unit_cost, v_qty * COALESCE(v_src_item.unit_cost, 0), NULL, NULL, 'pending'
    ) RETURNING id INTO v_line_id;

    v_posted := public.post_inventory_movement(
      v_src_item.id, 'transfer', v_qty, 'transfer_out', v_transfer_id, v_line_id::text,
      'تحويل صادر', 'تحويل صادر (' || v_transfer_no || ')', now(), v_src_item.unit_cost, v_party, v_transfer_no,
      'delta', false, p_source_warehouse_id, v_src_item.product_id, 'transfer',
      NULL, NULL, 'warehouse_transfer', v_transfer_id::text, p_destination_warehouse_id, NULL, NULL, NULL
    );
    v_src_mv_id := (v_posted->>'id')::uuid;
    UPDATE public.warehouse_transfer_items SET source_movement_id = v_src_mv_id WHERE id = v_line_id;
    v_lines_created := v_lines_created + 1;
  END LOOP;
  IF v_lines_created = 0 THEN RAISE EXCEPTION 'no_valid_lines'; END IF;
  PERFORM set_config('app.inventory_internal_post', 'off', true);
  RETURN jsonb_build_object('ok', true, 'transfer_id', v_transfer_id, 'transfer_no', v_transfer_no, 'lines', v_lines_created);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_transfer_receipt(p_transfer_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.warehouse_transfers%ROWTYPE;
  v_line jsonb;
  v_li public.warehouse_transfer_items%ROWTYPE;
  v_rq numeric;
  v_total_sent numeric := 0;
  v_total_recv numeric := 0;
  v_new_status text;
  v_dest_mv_id uuid;
  v_line_status text;
  v_resolved_dest uuid;
  v_src_name text;
  v_posted jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_t FROM public.warehouse_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF NOT public.can_receive_warehouse_transfer(v_uid, v_t.destination_warehouse_id) THEN
    RAISE EXCEPTION 'insufficient_privilege_receive_transfer';
  END IF;
  IF v_t.status IN ('received','partially_received') THEN
    RETURN jsonb_build_object('ok', true, 'already_received', true, 'status', v_t.status);
  END IF;
  IF v_t.status = 'cancelled' THEN RAISE EXCEPTION 'transfer_cancelled'; END IF;
  SELECT name INTO v_src_name FROM public.warehouses WHERE id = v_t.source_warehouse_id;
  PERFORM set_config('app.inventory_internal_post', 'on', true);
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_li FROM public.warehouse_transfer_items
     WHERE id = (v_line->>'line_id')::uuid AND transfer_id = p_transfer_id FOR UPDATE;
    IF NOT FOUND OR v_li.line_status IN ('received','partial','rejected') THEN CONTINUE; END IF;
    v_rq := COALESCE((v_line->>'received_qty')::numeric, v_li.sent_qty);
    v_rq := GREATEST(0, v_rq);
    IF v_rq <> v_li.sent_qty AND COALESCE(trim(v_line->>'notes'), '') = '' THEN
      RAISE EXCEPTION 'يلزم كتابة ملاحظة عند اختلاف الكمية المستلمة عن المرسلة (عجز أو زيادة): %', v_li.item_name;
    END IF;
    v_resolved_dest := public.resolve_inventory_transfer_destination(v_li.source_item_id, v_t.destination_warehouse_id);
    IF v_t.destination_warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid AND v_resolved_dest IS NULL THEN
      RAISE EXCEPTION 'destination_item_mapping_required: %', v_li.item_name;
    END IF;
    IF v_resolved_dest IS NOT NULL AND v_resolved_dest <> v_li.destination_item_id THEN
      UPDATE public.warehouse_transfer_items SET destination_item_id = v_resolved_dest WHERE id = v_li.id;
      v_li.destination_item_id := v_resolved_dest;
    END IF;
    v_dest_mv_id := NULL;
    IF v_t.legacy_dual_post = false AND v_rq > 0 AND v_li.destination_movement_id IS NULL THEN
      v_posted := public.post_inventory_movement(
        v_li.destination_item_id, 'in', v_rq, 'transfer_in', v_t.id, v_li.id::text,
        CASE WHEN v_rq <> v_li.sent_qty THEN 'فرق استلام' ELSE 'استلام تحويل' END,
        'استلام تحويل (' || v_t.transfer_no || ')'
          || CASE WHEN v_rq <> v_li.sent_qty THEN ' — مستلم ' || v_rq || ' من ' || v_li.sent_qty || COALESCE(' — ' || NULLIF(v_line->>'notes', ''), '') ELSE '' END,
        now(), v_li.unit_cost, COALESCE(NULLIF(btrim(v_src_name), ''), 'مخزن المصدر'), v_t.transfer_no,
        'delta', false, v_t.destination_warehouse_id, NULL, 'transfer',
        NULL, NULL, 'warehouse_transfer', v_t.id::text, NULL, NULL, NULL, NULL
      );
      v_dest_mv_id := (v_posted->>'id')::uuid;
    END IF;
    v_line_status := CASE WHEN v_rq = 0 THEN 'rejected' WHEN v_rq >= v_li.sent_qty THEN 'received' ELSE 'partial' END;
    UPDATE public.warehouse_transfer_items
       SET received_qty = v_rq,
           receive_notes = NULLIF(v_line->>'notes', ''),
           destination_movement_id = COALESCE(destination_movement_id, v_dest_mv_id),
           line_status = v_line_status
     WHERE id = v_li.id;
  END LOOP;
  SELECT COALESCE(SUM(sent_qty), 0), COALESCE(SUM(received_qty), 0)
    INTO v_total_sent, v_total_recv
  FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouse_transfer_items
     WHERE transfer_id = p_transfer_id
       AND COALESCE(line_status, '') NOT IN ('received', 'rejected')
  ) THEN
    v_new_status := CASE WHEN v_total_recv = 0 THEN 'pending_receipt' ELSE 'received' END;
  ELSE
    v_new_status := CASE WHEN v_total_recv = 0 THEN 'pending_receipt' ELSE 'partially_received' END;
  END IF;
  UPDATE public.warehouse_transfers
     SET status = v_new_status, received_by = v_uid, received_at = now(), notes = COALESCE(p_notes, notes),
         audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'event','receipt_confirmed','by',v_uid,'at',now(),
           'total_sent',v_total_sent,'total_received',v_total_recv,'status',v_new_status,
           'legacy_dual_post', v_t.legacy_dual_post))
   WHERE id = p_transfer_id;
  PERFORM set_config('app.inventory_internal_post', 'off', true);
  RETURN jsonb_build_object('ok', true, 'status', v_new_status, 'total_sent', v_total_sent, 'total_received', v_total_recv);
END;
$function$;

-- Stock engine screen. Adjustment stays an absolute target ("القيمة الجديدة").
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
  p_override_negative boolean DEFAULT false
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

  PERFORM set_config('app.inventory_internal_post', 'on', true);
  v_posted := public.post_inventory_movement(
    p_item_id, p_movement_type, p_quantity, v_source, gen_random_uuid(), '1',
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

CREATE OR REPLACE FUNCTION public.inv_transfer(
  p_source_item_id uuid,
  p_destination_warehouse_id uuid,
  p_quantity numeric,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_src public.inventory_items%ROWTYPE;
  v_dest_item_id uuid;
  v_uid uuid := auth.uid();
  v_doc uuid := gen_random_uuid();
BEGIN
  IF NOT public.can_post_inventory(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: السبب مطلوب';
  END IF;
  SELECT * INTO v_src FROM public.inventory_items WHERE id = p_source_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_NOT_FOUND'; END IF;
  IF v_src.warehouse_id = p_destination_warehouse_id THEN RAISE EXCEPTION 'SAME_WAREHOUSE'; END IF;

  SELECT id INTO v_dest_item_id FROM public.inventory_items
   WHERE warehouse_id = p_destination_warehouse_id AND name = v_src.name
   ORDER BY id LIMIT 1;
  IF v_dest_item_id IS NULL THEN
    INSERT INTO public.inventory_items(
      warehouse_id, name, category, unit, stock, unit_cost, low_stock_threshold, module, item_code
    ) VALUES (
      p_destination_warehouse_id, v_src.name, v_src.category, v_src.unit, 0, v_src.unit_cost,
      v_src.low_stock_threshold, v_src.module, v_src.item_code
    ) RETURNING id INTO v_dest_item_id;
  END IF;

  PERFORM set_config('app.inventory_internal_post', 'on', true);
  PERFORM public.post_inventory_movement(
    p_source_item_id, 'transfer', p_quantity, 'transfer_out', v_doc, 'out',
    btrim(p_reason), NULL, now(), v_src.unit_cost, NULL, NULL, 'delta', false,
    v_src.warehouse_id, v_src.product_id, v_src.module, NULL, NULL, 'transfer_out', v_doc::text,
    p_destination_warehouse_id, NULL, NULL, NULL
  );
  PERFORM public.post_inventory_movement(
    v_dest_item_id, 'in', p_quantity, 'transfer_in', v_doc, 'in',
    btrim(p_reason), NULL, now(), v_src.unit_cost, NULL, NULL, 'delta', false,
    p_destination_warehouse_id, NULL, v_src.module, NULL, NULL, 'transfer_in', v_doc::text,
    NULL, NULL, NULL, NULL
  );
  PERFORM set_config('app.inventory_internal_post', 'off', true);
  RETURN jsonb_build_object('success', true, 'destination_item_id', v_dest_item_id, 'source_id', v_doc);
END;
$$;

-- Compatibility bridge: historical SECURITY DEFINER functions that still INSERT
-- a movement (meat, feed, slaughter, and older wrappers) may do so only because
-- they set the ledger flag. Clients cannot. New code must call post_inventory_movement.
DO $inj$
DECLARE
  r record;
  src text;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
      AND p.proname NOT IN ('post_inventory_movement', 'reject_direct_inventory_movement_write')
      AND pg_get_functiondef(p.oid) ILIKE '%INSERT INTO public.inventory_movements%'
      AND pg_get_functiondef(p.oid) NOT ILIKE '%app.inventory_ledger_posted%'
  LOOP
    src := regexp_replace(
      r.def,
      'BEGIN',
      E'BEGIN\n  PERFORM set_config(''app.inventory_ledger_posted'', ''on'', true);',
      1, 1
    );
    EXECUTE src;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'ledger flag injected into % legacy movement inserters', n;
END
$inj$;
