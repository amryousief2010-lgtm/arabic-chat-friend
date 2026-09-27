-- P0 / 3 — Period lock after an approved stocktake.
-- A movement whose performed_at is earlier than the warehouse lock is rejected
-- in Arabic. general_manager and executive_manager may override with a logged reason.
-- Deliveries dated before the lock are marked skipped_period_lock and do not deduct.
-- Locks start only at the 30 Sep 2026 count (Africa/Cairo). Earlier approvals,
-- including any session already approved, do not create a lock row.

CREATE TABLE IF NOT EXISTS public.warehouse_period_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  locked_until timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'stocktaking',
  source_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS warehouse_period_locks_source_uidx
  ON public.warehouse_period_locks(source, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS warehouse_period_locks_wh_idx
  ON public.warehouse_period_locks(warehouse_id, locked_until DESC);

CREATE TABLE IF NOT EXISTS public.period_lock_override_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid,
  movement_id uuid,
  performed_at timestamptz,
  locked_until timestamptz,
  reason text NOT NULL,
  acted_by uuid,
  acted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_period_lock_skips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  warehouse_id uuid,
  delivered_at timestamptz,
  locked_until timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS period_lock_override_reason text;

ALTER TABLE public.warehouse_period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.period_lock_override_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_period_lock_skips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_period_locks_read ON public.warehouse_period_locks;
CREATE POLICY warehouse_period_locks_read ON public.warehouse_period_locks
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor','agouza_warehouse_keeper']::app_role[]));

DROP POLICY IF EXISTS period_lock_override_log_read ON public.period_lock_override_log;
CREATE POLICY period_lock_override_log_read ON public.period_lock_override_log
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager']::app_role[]));

DROP POLICY IF EXISTS order_period_lock_skips_read ON public.order_period_lock_skips;
CREATE POLICY order_period_lock_skips_read ON public.order_period_lock_skips
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor']::app_role[]));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_stock_status_chk;
ALTER TABLE public.orders ADD CONSTRAINT orders_stock_status_chk
  CHECK (stock_status IN (
    'not_dispatched','checked','reserved','dispatched','returned','blocked','reservation_released','skipped_period_lock'
  ));

CREATE OR REPLACE FUNCTION public.warehouse_period_locked_until(p_warehouse uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT max(locked_until) FROM public.warehouse_period_locks WHERE warehouse_id = p_warehouse;
$$;

REVOKE ALL ON FUNCTION public.warehouse_period_locked_until(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.warehouse_period_locked_until(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_inventory_period_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lock timestamptz;
  v_uid uuid := auth.uid();
  v_reason text;
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'posted' THEN
    RETURN NEW;
  END IF;
  IF NEW.performed_at IS NULL OR NEW.warehouse_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_lock := public.warehouse_period_locked_until(NEW.warehouse_id);
  IF v_lock IS NULL OR NEW.performed_at >= v_lock THEN
    RETURN NEW;
  END IF;

  v_reason := NULLIF(btrim(COALESCE(NEW.period_lock_override_reason, '')), '');
  IF v_reason IS NOT NULL
     AND length(v_reason) >= 3
     AND v_uid IS NOT NULL
     AND (
       public.has_role(v_uid, 'general_manager'::app_role)
       OR public.has_role(v_uid, 'executive_manager'::app_role)
     ) THEN
    INSERT INTO public.period_lock_override_log(warehouse_id, movement_id, performed_at, locked_until, reason, acted_by)
    VALUES (NEW.warehouse_id, NEW.id, NEW.performed_at, v_lock, v_reason, v_uid);
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'الفترة مقفلة لهذا المخزن حتى %. لا يمكن تسجيل حركة بتاريخ أقدم من اعتماد الجرد. التجاوز للمدير العام أو المدير التنفيذي مع سبب مكتوب.',
    to_char(v_lock AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI');
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_inventory_period_lock ON public.inventory_movements;
CREATE TRIGGER trg_enforce_inventory_period_lock
BEFORE INSERT OR UPDATE OF performed_at, warehouse_id, approval_status
ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.enforce_inventory_period_lock();

CREATE OR REPLACE FUNCTION public.lock_warehouse_after_stocktake()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'approved'
     AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.approved_at IS NOT NULL
     AND NEW.approved_at >= timestamptz '2026-09-30 00:00:00 Africa/Cairo' THEN
    INSERT INTO public.warehouse_period_locks(warehouse_id, locked_until, source, source_id, created_by)
    SELECT NEW.warehouse_id, NEW.approved_at, 'stocktaking', NEW.id, NEW.approved_by
     WHERE NOT EXISTS (
       SELECT 1 FROM public.warehouse_period_locks l
        WHERE l.source = 'stocktaking' AND l.source_id = NEW.id
     );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_warehouse_after_stocktake ON public.stocktaking_sessions;
CREATE TRIGGER trg_lock_warehouse_after_stocktake
AFTER UPDATE OF status ON public.stocktaking_sessions
FOR EACH ROW EXECUTE FUNCTION public.lock_warehouse_after_stocktake();

-- No backfill. Approvals before 2026-09-30 00:00 Africa/Cairo must not create locks,
-- and sessions already approved (including a future Sep 30 count applied before this
-- migration) are not replayed. Only a new approval at or after that cutoff inserts a row.


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
  v_inv        record;
  v_avail      numeric;
  v_issues     jsonb := '[]'::jsonb;
  v_msgs       text[] := ARRAY[]::text[];
  v_first_code text;
  v_movements  int := 0;
  v_total_qty  numeric := 0;
  v_resv       int := 0;
  v_by         text := COALESCE(p_actor::text, 'system:auto_dispatch');
  v_lock       timestamptz;
BEGIN
  SELECT id, order_number, shipping_company, source_warehouse_id, stock_status, status, delivered_at
    INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND — الأوردر غير موجود';
  END IF;

  IF v_order.source_warehouse_id IS NOT NULL
     AND NOT public._order_auto_dispatch_allowed(v_order.source_warehouse_id, v_order.delivered_at) THEN
    RETURN jsonb_build_object('status','manual_warehouse_skipped','order_id',p_order_id,
      'message','المخزن الرئيسي: الأوردر اتسلّم قبل تفعيل الخصم التلقائي — لا يتم الخصم بأثر رجعي');
  END IF;

  IF v_order.stock_status = 'dispatched' THEN
    PERFORM public._resolve_order_stock_dispatch_failures(p_order_id, v_by);
    RETURN jsonb_build_object('status','already_dispatched','order_id', p_order_id,'order_number', v_order.order_number);
  END IF;

  IF EXISTS (SELECT 1 FROM public._order_net_dispatched_items(p_order_id)) THEN
    UPDATE public.orders SET stock_status = 'dispatched'
     WHERE id = p_order_id AND stock_status IS DISTINCT FROM 'dispatched';
    IF p_commit_reservations THEN
      v_resv := public._commit_order_reservations_after_dispatch(p_order_id, p_actor, 'dispatch_order_stock:already_dispatched');
    END IF;
    PERFORM public._resolve_order_stock_dispatch_failures(p_order_id, v_by);
    RETURN jsonb_build_object('status','already_dispatched','order_id',p_order_id,'order_number', v_order.order_number,
                              'reservations_committed', v_resv);
  END IF;

  v_lock := public.warehouse_period_locked_until(v_order.source_warehouse_id);
  IF v_lock IS NOT NULL AND v_order.delivered_at IS NOT NULL AND v_order.delivered_at < v_lock THEN
    UPDATE public.orders SET stock_status = 'skipped_period_lock' WHERE id = p_order_id;
    INSERT INTO public.order_period_lock_skips(order_id, warehouse_id, delivered_at, locked_until, note)
    VALUES (p_order_id, v_order.source_warehouse_id, v_order.delivered_at, v_lock,
            'تسليم قبل قفل الجرد — بدون خصم حتى لا يُخصم المخزون مرتين');
    PERFORM public._resolve_order_stock_dispatch_failures(p_order_id, 'system:period_lock');
    RETURN jsonb_build_object('status','skipped_period_lock','order_id',p_order_id,
      'order_number', v_order.order_number, 'locked_until', v_lock);
  END IF;

  IF v_order.source_warehouse_id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'SOURCE_WAREHOUSE_UNRESOLVED — لم يتم تحديد المخزن المصدر للأوردر (طريقة التوصيل)',
      DETAIL  = jsonb_build_array(jsonb_build_object('code','SOURCE_WAREHOUSE_UNRESOLVED'))::text;
  END IF;

  FOR v_item IN
    SELECT oi.id AS order_item_id, oi.product_id, btrim(COALESCE(p.name, oi.product_name, '')) AS pname,
           oi.quantity::numeric AS qty, p.is_active, p.barcode
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
  LOOP
    IF v_item.product_id IS NULL THEN
      v_issues := v_issues || jsonb_build_object('code','PRODUCT_MISSING','product_name',v_item.pname);
      v_msgs := v_msgs || format('البند "%s" لا يحتوي على منتج', v_item.pname);
    ELSIF v_item.is_active IS NOT TRUE THEN
      v_issues := v_issues || jsonb_build_object('code','PRODUCT_INACTIVE','product_id',v_item.product_id,'product_name',v_item.pname);
      v_msgs := v_msgs || format('المنتج "%s" غير نشط', v_item.pname);
    ELSIF v_item.barcode IS NULL OR length(btrim(v_item.barcode)) = 0 THEN
      v_issues := v_issues || jsonb_build_object('code','PRODUCT_NO_BARCODE','product_id',v_item.product_id,'product_name',v_item.pname);
      v_msgs := v_msgs || format('المنتج "%s" بدون باركود', v_item.pname);
    ELSIF v_item.qty IS NULL OR v_item.qty <= 0 THEN
      v_issues := v_issues || jsonb_build_object('code','INVALID_QUANTITY','product_id',v_item.product_id,'product_name',v_item.pname);
      v_msgs := v_msgs || format('كمية غير صالحة للبند "%s"', v_item.pname);
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT oi.product_id, min(btrim(COALESCE(p.name, oi.product_name, ''))) AS pname, SUM(oi.quantity)::numeric AS qty
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL AND oi.quantity > 0
    GROUP BY oi.product_id
  LOOP
    SELECT id, stock, reserved_qty, blocked_qty INTO v_inv
    FROM public.inventory_items
    WHERE product_id = v_item.product_id AND warehouse_id = v_order.source_warehouse_id
    FOR UPDATE;

    IF v_inv.id IS NULL THEN
      v_issues := v_issues || jsonb_build_object('code','INVENTORY_ROW_MISSING','product_id',v_item.product_id,'product_name',v_item.pname);
      v_msgs := v_msgs || format('لا يوجد صنف "%s" في المخزن المصدر', v_item.pname);
    ELSE
      v_avail := COALESCE(v_inv.stock,0) - COALESCE(v_inv.reserved_qty,0) - COALESCE(v_inv.blocked_qty,0);
      IF v_avail < v_item.qty THEN
        v_issues := v_issues || jsonb_build_object('code','INSUFFICIENT_STOCK','product_id',v_item.product_id,
                      'product_name',v_item.pname,'required',v_item.qty,'available',v_avail);
        v_msgs := v_msgs || format('رصيد "%s" غير كافٍ (المطلوب %s، المتاح %s)', v_item.pname, v_item.qty, v_avail);
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_issues) > 0 THEN
    v_first_code := v_issues->0->>'code';
    RAISE EXCEPTION USING
      MESSAGE = v_first_code || ' — ' || array_to_string(v_msgs, '؛ '),
      DETAIL  = v_issues::text;
  END IF;

  FOR v_item IN
    SELECT oi.id AS order_item_id, oi.product_id, oi.quantity::numeric AS qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL
  LOOP
    SELECT id, unit_cost INTO v_inv
    FROM public.inventory_items
    WHERE product_id = v_item.product_id AND warehouse_id = v_order.source_warehouse_id
    FOR UPDATE;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, source_warehouse_id,
      movement_type, quantity, unit_cost, total_cost,
      reference_type, reference_id,
      reason, party, notes,
      performed_by, performed_at, approval_status, module, product_id, effect_mode
    ) VALUES (
      v_inv.id, v_order.source_warehouse_id, v_order.source_warehouse_id,
      'sales_dispatch', v_item.qty, COALESCE(v_inv.unit_cost,0),
      v_item.qty * COALESCE(v_inv.unit_cost,0),
      'order', p_order_id::text,
      'صرف مبيعات', COALESCE(v_order.shipping_company,'—'),
      concat('صرف تلقائي للأوردر ', v_order.order_number, CASE WHEN p_note IS NOT NULL THEN ' — ' || p_note END),
      p_actor, COALESCE(v_order.delivered_at, now()), 'posted', 'sales', v_item.product_id, 'delta'
    );

    v_movements := v_movements + 1;
    v_total_qty := v_total_qty + v_item.qty;
  END LOOP;

  UPDATE public.orders SET stock_status = 'dispatched' WHERE id = p_order_id;

  IF p_commit_reservations THEN
    v_resv := public._commit_order_reservations_after_dispatch(p_order_id, p_actor, 'dispatch_order_stock');
  END IF;

  PERFORM public._resolve_order_stock_dispatch_failures(p_order_id, v_by);

  RETURN jsonb_build_object('status','dispatched','order_id',p_order_id,'order_number',v_order.order_number,
    'movements', v_movements, 'total_qty', v_total_qty, 'reservations_committed', v_resv);
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_agouza_stock_on_delivery(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agouza_wh constant uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
  v_src uuid;
  v_committed jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  r record;
  v_unit_cost numeric;
  v_existing_count integer;
  v_delivered timestamptz;
  v_lock timestamptz;
BEGIN
  IF NOT public.can_operate_agouza_order(p_order_id, 'commit') THEN
    INSERT INTO public.agouza_reservation_audit_log(order_id, action, reason, details, success)
    VALUES (p_order_id, 'commit', 'permission_denied',
            jsonb_build_object('uid', auth.uid()), false);
    RAISE EXCEPTION 'غير مصرح بتنفيذ خصم مخزون العجوزة لهذا الأوردر';
  END IF;

  SELECT source_warehouse_id INTO v_src FROM public.orders WHERE id = p_order_id;
  IF v_src IS NULL OR v_src <> v_agouza_wh THEN
    RAISE EXCEPTION 'هذا الأوردر ليس تابعاً لمخزن العجوزة';
  END IF;

  SELECT delivered_at INTO v_delivered FROM public.orders WHERE id = p_order_id;
  v_lock := public.warehouse_period_locked_until(v_agouza_wh);
  IF v_lock IS NOT NULL AND v_delivered IS NOT NULL AND v_delivered < v_lock THEN
    UPDATE public.orders SET stock_status = 'skipped_period_lock' WHERE id = p_order_id;
    INSERT INTO public.order_period_lock_skips(order_id, warehouse_id, delivered_at, locked_until, note)
    VALUES (p_order_id, v_agouza_wh, v_delivered, v_lock, 'تسليم عجوزة قبل قفل الجرد — بدون خصم');
    RETURN jsonb_build_object('ok', true, 'skipped_period_lock', true, 'locked_until', v_lock);
  END IF;

  FOR r IN
    SELECT id, inventory_item_id, product_id, quantity
    FROM public.agouza_stock_reservations
    WHERE order_id = p_order_id AND status = 'active'
  LOOP
    SELECT COUNT(*) INTO v_existing_count FROM public.inventory_movements
    WHERE reference_type = 'order' AND reference_id = p_order_id::text
      AND item_id = r.inventory_item_id AND movement_type = 'sales_dispatch';

    IF v_existing_count > 0 THEN
      v_skipped := v_skipped || jsonb_build_object('inventory_item_id', r.inventory_item_id, 'reason', 'already_committed');
      UPDATE public.agouza_stock_reservations
         SET status = 'committed', committed_at = now(), committed_by = auth.uid()
       WHERE id = r.id;
      CONTINUE;
    END IF;

    SELECT unit_cost INTO v_unit_cost FROM public.inventory_items WHERE id = r.inventory_item_id;

    PERFORM 1 FROM public.inventory_items WHERE id = r.inventory_item_id AND stock >= r.quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'رصيد غير كافٍ عند التنفيذ للصنف %', r.inventory_item_id;
    END IF;

    -- Trigger apply_inventory_movement deducts stock for sales_dispatch.
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, product_id, module, reason, approval_status, effect_mode, performed_at
    ) VALUES (
      r.inventory_item_id, v_agouza_wh, 'sales_dispatch', r.quantity, COALESCE(v_unit_cost, 0),
      'order', p_order_id::text, r.product_id, 'agouza_sales', 'تسليم أوردر عجوزة', 'posted', 'delta',
      COALESCE(v_delivered, now())
    );

    UPDATE public.agouza_stock_reservations
       SET status = 'committed', committed_at = now(), committed_by = auth.uid()
     WHERE id = r.id;

    v_committed := v_committed || jsonb_build_object('inventory_item_id', r.inventory_item_id, 'quantity', r.quantity);
  END LOOP;

  INSERT INTO public.agouza_reservation_audit_log(order_id, action, reason, details, success)
  VALUES (p_order_id, 'commit', 'order_delivered', jsonb_build_object('committed', v_committed, 'skipped', v_skipped), true);

  RETURN jsonb_build_object('ok', true, 'committed', v_committed, 'skipped', v_skipped);
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_failed_order_dispatches(p_warehouse_id uuid, p_since date DEFAULT '2026-09-19', p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_agouza     constant uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
  v_uid        uuid := auth.uid();
  v_since_ts   timestamptz := (p_since::timestamp AT TIME ZONE 'Asia/Riyadh');
  v_main_from  timestamptz := public._main_wh_auto_dispatch_from();
  r            record;
  v_res        jsonb;
  v_err        text;
  v_detail     text;
  v_details    jsonb;
  v_note       text;
  v_was_open   boolean;
  v_candidates int := 0;
  v_dispatched int := 0;
  v_already    int := 0;
  v_skipped    int := 0;
  v_failed     int := 0;
  v_new_fail   int := 0;
  v_stale      int := 0;
  v_cleaned    int := 0;
  v_ok_list    jsonb := '[]'::jsonb;
  v_fail_list  jsonb := '[]'::jsonb;
  v_by_reason  jsonb;
  v_top        text;
BEGIN
  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد المخزن قبل إعادة محاولة الخصم';
  END IF;

  IF v_uid IS NOT NULL AND NOT public.has_any_role(v_uid, ARRAY['general_manager','executive_manager','warehouse_supervisor']::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  FOR r IN
    SELECT o.id, o.order_number, o.source_warehouse_id, o.delivered_at
    FROM public.orders o
    WHERE o.status = 'delivered'
      AND o.source_warehouse_id = p_warehouse_id
      AND COALESCE(o.stock_status,'not_dispatched') NOT IN ('dispatched', 'skipped_period_lock')
      AND ( (o.source_warehouse_id = c_agouza AND o.delivered_at >= v_since_ts)
         OR (COALESCE(public.is_manual_stock_warehouse(o.source_warehouse_id), false)
             AND v_main_from IS NOT NULL AND o.delivered_at >= v_main_from) )
    ORDER BY o.delivered_at
  LOOP
    v_candidates := v_candidates + 1;
    v_note := 'استكمال خصم متأخر (retry) — تاريخ التسليم الأصلي: '
              || to_char(r.delivered_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' بتوقيت الرياض';
    BEGIN
      v_res := public._dispatch_order_stock_core(r.id, v_uid, v_note, true);
      IF p_dry_run THEN
        RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = '__DRY_RUN__', DETAIL = v_res::text;
      END IF;
      IF v_res->>'status' = 'dispatched' THEN
        v_dispatched := v_dispatched + 1;
        v_ok_list := v_ok_list || to_jsonb(r.order_number);
      ELSIF v_res->>'status' = 'already_dispatched' THEN
        v_already := v_already + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'P0099' THEN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        v_res := v_detail::jsonb;
        IF v_res->>'status' = 'dispatched' THEN
          v_dispatched := v_dispatched + 1;
          v_ok_list := v_ok_list || to_jsonb(r.order_number);
        ELSIF v_res->>'status' = 'already_dispatched' THEN
          v_already := v_already + 1;
        ELSE
          v_skipped := v_skipped + 1;
        END IF;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
        v_failed := v_failed + 1;
        BEGIN v_details := v_detail::jsonb; EXCEPTION WHEN OTHERS THEN v_details := NULL; END;
        v_fail_list := v_fail_list || jsonb_build_object('order_id', r.id, 'order_number', r.order_number,
                                                         'error', v_err, 'details', v_details);
        IF NOT p_dry_run THEN
          v_was_open := EXISTS (SELECT 1 FROM public.order_stock_dispatch_failures
                                WHERE order_id = r.id AND resolved_at IS NULL);
          PERFORM public._log_order_stock_dispatch_failure(r.id, v_err, v_detail, false);
          IF NOT v_was_open THEN v_new_fail := v_new_fail + 1; END IF;
        END IF;
    END;
  END LOOP;

  IF NOT p_dry_run THEN
    FOR r IN
      SELECT DISTINCT asr.order_id
      FROM public.agouza_stock_reservations asr
      JOIN public.orders o ON o.id = asr.order_id
      WHERE asr.status = 'active' AND o.status = 'delivered' AND o.stock_status = 'dispatched'
        AND EXISTS (SELECT 1 FROM public._order_net_dispatched_items(o.id))
    LOOP
      v_stale := v_stale + public._commit_order_reservations_after_dispatch(r.order_id, v_uid, 'stale_active_after_dispatch_cleanup');
    END LOOP;

    UPDATE public.order_stock_dispatch_failures f
       SET resolved_at = now(), resolved_by = 'system:retry_cleanup'
      FROM public.orders o
     WHERE o.id = f.order_id AND f.resolved_at IS NULL
       AND (o.status <> 'delivered' OR o.stock_status = 'dispatched');
    GET DIAGNOSTICS v_cleaned = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_stale
    FROM public.agouza_stock_reservations asr
    JOIN public.orders o ON o.id = asr.order_id
    WHERE asr.status = 'active' AND o.status = 'delivered' AND o.stock_status = 'dispatched'
      AND EXISTS (SELECT 1 FROM public._order_net_dispatched_items(o.id));
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'product', product, 'orders', n) ORDER BY n DESC, code, product), '[]'::jsonb)
    INTO v_by_reason
  FROM (
    SELECT i->>'code' AS code, COALESCE(i->>'product_name', '-') AS product, count(DISTINCT f->>'order_id') AS n
    FROM jsonb_array_elements(v_fail_list) f,
         jsonb_array_elements(CASE WHEN jsonb_typeof(f->'details') = 'array' THEN f->'details' ELSE '[]'::jsonb END) i
    GROUP BY 1, 2
  ) s;

  IF NOT p_dry_run AND v_new_fail > 0 THEN
    SELECT string_agg(
             (e->>'product') || ': ' ||
             CASE e->>'code'
               WHEN 'INSUFFICIENT_STOCK'    THEN 'رصيد غير كافٍ'
               WHEN 'PRODUCT_NO_BARCODE'    THEN 'بدون باركود'
               WHEN 'INVENTORY_ROW_MISSING' THEN 'غير موجود بالمخزن'
               WHEN 'PRODUCT_INACTIVE'      THEN 'منتج غير نشط'
               WHEN 'PRODUCT_MISSING'       THEN 'بند بدون منتج'
               ELSE e->>'code' END
             || ' (' || (e->>'orders') || ')', '، ')
      INTO v_top
    FROM (SELECT e FROM jsonb_array_elements(v_by_reason) e LIMIT 6) t;

    INSERT INTO public.notifications(title, description, type, order_id, target_user_id)
    SELECT '⚠️ أوردرات مسلّمة بدون خصم مخزون',
           'مراجعة خصم المخزون للأوردرات المسلّمة منذ ' || p_since::text || ': تم خصم ' || v_dispatched
             || ' أوردر الآن، وما زال ' || v_failed || ' أوردر معلقاً بدون خصم. أهم الأسباب: ' || COALESCE(v_top, '-')
             || '. سيتم الخصم عند إعادة المحاولة بعد استلام التحويلات وتصحيح البيانات.',
           'stock_dispatch_failed', NULL, u.user_id
    FROM (SELECT DISTINCT ur.user_id FROM public.user_roles ur
          WHERE ur.role::text IN ('warehouse_supervisor','general_manager','executive_manager')) u;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'warehouse_id', p_warehouse_id,
    'since', p_since,
    'main_wh_auto_dispatch_from', v_main_from,
    'candidates', v_candidates,
    'dispatched', v_dispatched,
    'already_dispatched', v_already,
    'skipped', v_skipped,
    'still_failing', v_failed,
    'new_failures_logged', v_new_fail,
    'stale_active_reservations_committed', v_stale,
    'failures_auto_resolved', v_cleaned,
    'failures_by_reason_product', v_by_reason,
    'dispatched_orders', v_ok_list,
    'failing_orders', v_fail_list
  );
END;
$function$;


DROP FUNCTION IF EXISTS public.retry_failed_order_dispatches(date, boolean);

GRANT EXECUTE ON FUNCTION public.retry_failed_order_dispatches(uuid, date, boolean) TO authenticated, service_role;
