-- P0 — One order-deduction path for every warehouse.
-- _dispatch_order_stock_core is the only writer of sales_dispatch.
-- commit_agouza_stock_on_delivery delegates to it and only marks reservations.
-- Idempotent per order line (order_items.id), not per (order, card).
-- Two lines of the same product both post. Historical sales_dispatch rows
-- stay untouched: the unique index ignores them when order_item_id is null
-- or created_at is before 2026-09-27.
-- Several cards for one product in one warehouse: the lowest id is canonical.
-- No linked card: the line is recorded as failed, not skipped in silence.

CREATE TABLE IF NOT EXISTS public.order_deduction_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  product_id uuid,
  order_item_id uuid,
  inventory_item_id uuid,
  quantity numeric,
  status text NOT NULL CHECK (status IN ('posted', 'failed')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS order_deduction_lines_order_product_uidx
  ON public.order_deduction_lines (order_id, product_id)
  WHERE order_item_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS order_deduction_lines_order_line_uidx
  ON public.order_deduction_lines (order_id, order_item_id)
  WHERE order_item_id IS NOT NULL;

ALTER TABLE public.order_deduction_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_deduction_lines_read ON public.order_deduction_lines;
CREATE POLICY order_deduction_lines_read ON public.order_deduction_lines
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'warehouse_supervisor'::public.app_role)
    OR public.has_role(auth.uid(), 'accountant'::public.app_role)
    OR public.has_role(auth.uid(), 'financial_manager'::public.app_role)
  );

GRANT SELECT ON public.order_deduction_lines TO authenticated, service_role;

-- Per order line, and only rows written from this migration forward.
-- Live history has several sales_dispatch rows for one (order, card): one per
-- order line, plus one May pair that nets to -1.5. Those rows are not deleted
-- and are excluded here (null order_item_id, or created_at before 2026-09-27).
CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_order_line_dispatch_uidx
  ON public.inventory_movements (reference_id, order_item_id)
  WHERE movement_type = 'sales_dispatch'
    AND reference_type = 'order'
    AND order_item_id IS NOT NULL
    AND COALESCE(approval_status, 'posted') = 'posted'
    AND created_at >= timestamptz '2026-09-27 00:00:00+00';

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

    IF v_item.product_id IS NULL OR v_item.missing_product THEN
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
        IF EXISTS (
          SELECT 1 FROM public.inventory_movements m
           WHERE m.reference_type = 'order'
             AND m.reference_id = p_order_id::text
             AND m.order_item_id = v_item.order_item_id
             AND m.movement_type = 'sales_dispatch'
             AND COALESCE(m.approval_status, 'posted') = 'posted'
        ) OR EXISTS (
          SELECT 1 FROM public.order_deduction_lines d
           WHERE d.order_id = p_order_id
             AND d.order_item_id = v_item.order_item_id
             AND d.status = 'posted'
        ) THEN
          v_movements := v_movements + 1;
          CONTINUE;
        END IF;

        v_avail := COALESCE(v_stock, 0) - v_reserved - v_blocked;
        IF v_avail < v_item.qty THEN
          v_reason := format('رصيد "%s" غير كافٍ (المطلوب %s، المتاح %s)', v_item.pname, v_item.qty, v_avail);
        END IF;
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_failures := v_failures + 1;
      v_details := v_details || jsonb_build_object(
        'product_id', v_item.product_id, 'product_name', v_item.pname, 'reason', v_reason
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

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, source_warehouse_id,
      movement_type, quantity, unit_cost, total_cost,
      reference_type, reference_id, order_item_id,
      reason, party, notes,
      performed_by, performed_at, approval_status, module, product_id, effect_mode
    ) VALUES (
      v_canonical, v_order.source_warehouse_id, v_order.source_warehouse_id,
      'sales_dispatch', v_item.qty, COALESCE(v_cost, 0),
      v_item.qty * COALESCE(v_cost, 0),
      'order', p_order_id::text, v_item.order_item_id,
      'صرف مبيعات', COALESCE(v_order.shipping_company, '—'),
      concat(
        'صرف تلقائي للأوردر ', v_order.order_number,
        ' canonical_item=', v_canonical::text,
        CASE WHEN p_note IS NOT NULL THEN ' — ' || p_note ELSE '' END
      ),
      p_actor, COALESCE(v_order.delivered_at, now()), 'posted', 'sales', v_item.product_id, 'delta'
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
    -- A missing notification target must not undo the recorded line failure.
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

  RETURN jsonb_build_object('status','dispatched','order_id',p_order_id,'order_number',v_order.order_number,
    'movements', v_movements, 'total_qty', v_total_qty, 'reservations_committed', v_resv);
END;
$function$;

-- The Agouza RPC no longer inserts its own sales_dispatch.
CREATE OR REPLACE FUNCTION public.commit_agouza_stock_on_delivery(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.can_operate_agouza_order(p_order_id, 'commit') THEN
    INSERT INTO public.agouza_reservation_audit_log(order_id, action, reason, details, success)
    VALUES (p_order_id, 'commit', 'permission_denied', jsonb_build_object('uid', auth.uid()), false);
    RAISE EXCEPTION 'غير مصرح بتنفيذ خصم مخزون العجوزة لهذا الأوردر';
  END IF;

  v_result := public._dispatch_order_stock_core(p_order_id, auth.uid(), 'commit_agouza', false);

  INSERT INTO public.agouza_reservation_audit_log(order_id, action, reason, details, success)
  VALUES (p_order_id, 'commit', 'unified_dispatch', v_result, COALESCE(v_result->>'status', '') <> 'partial_or_failed');

  RETURN v_result;
END;
$$;
