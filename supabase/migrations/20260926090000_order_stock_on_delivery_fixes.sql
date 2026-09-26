-- =============================================================================
-- 20260926090000_order_stock_on_delivery_fixes.sql
-- Order stock deduction on delivery — approved changes A–E (2026-09-26)
--   A) Main warehouse (المخزن الرئيسي - المقر) now auto-deducts on delivery for
--      orders delivered at/after stock_automation_settings.main_wh_auto_dispatch_from
--      (no retroactive deduction). is_manual_stock_warehouse() is NOT changed.
--   B) Legacy products.stock deduction/toggles removed (order create, item
--      update/delete, cancel/uncancel, order delete). products.stock is now only
--      maintained manually (Products / ManufacturingQueue screens).
--   C) Dispatch failures are no longer swallowed silently: logged into
--      public.order_stock_dispatch_failures + notifications to
--      warehouse_supervisor / general_manager / executive_manager. Delivery
--      status update is never blocked.
--   D) public.retry_failed_order_dispatches(p_since, p_dry_run) backfill/retry
--      helper (service_role / postgres only).
--   E) Barcodes for "دهن النعام" and "نخاع " (next EAN-13 in 622400320xxx series).
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) Settings table + helpers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_automation_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_automation_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_automation_settings_read" ON public.stock_automation_settings;
CREATE POLICY "stock_automation_settings_read" ON public.stock_automation_settings
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.stock_automation_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stock_automation_settings FROM authenticated;
GRANT SELECT ON public.stock_automation_settings TO authenticated;

INSERT INTO public.stock_automation_settings(key, value, description)
VALUES ('main_wh_auto_dispatch_from',
        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'Orders of the main warehouse (5ec781b5-685b-4806-b59a-83a79ea5662c) delivered at/after this UTC timestamp are auto-deducted on delivery. Earlier deliveries are never deducted retroactively.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public._main_wh_auto_dispatch_from()
 RETURNS timestamptz
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(btrim(value), '')::timestamptz
  FROM public.stock_automation_settings
  WHERE key = 'main_wh_auto_dispatch_from';
$function$;

-- true when an order from warehouse p_wh delivered at p_at should be auto-deducted
CREATE OR REPLACE FUNCTION public._order_auto_dispatch_allowed(p_wh uuid, p_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_wh IS NULL THEN false
    WHEN NOT COALESCE(public.is_manual_stock_warehouse(p_wh), false) THEN true
    ELSE COALESCE(p_at, now()) >= COALESCE(public._main_wh_auto_dispatch_from(), 'infinity'::timestamptz)
  END;
$function$;

-- Net quantity still dispatched (sales_dispatch - sales_return) per inventory item for an order.
-- Main-warehouse movements only count if performed at/after the auto-dispatch start
-- (historic main-warehouse movements are handled manually and never auto-returned).
CREATE OR REPLACE FUNCTION public._order_net_dispatched_items(p_order_id uuid)
 RETURNS TABLE(item_id uuid, warehouse_id uuid, net_qty numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.item_id, m.warehouse_id,
         SUM(CASE WHEN m.movement_type = 'sales_dispatch' THEN abs(m.quantity) ELSE -abs(m.quantity) END) AS net_qty
  FROM public.inventory_movements m
  WHERE m.reference_type = 'order'
    AND m.reference_id = p_order_id::text
    AND m.movement_type IN ('sales_dispatch', 'sales_return')
    AND COALESCE(m.approval_status, 'posted') = 'posted'
    AND (NOT COALESCE(public.is_manual_stock_warehouse(m.warehouse_id), false)
         OR m.performed_at >= COALESCE(public._main_wh_auto_dispatch_from(), 'infinity'::timestamptz))
  GROUP BY m.item_id, m.warehouse_id
  HAVING SUM(CASE WHEN m.movement_type = 'sales_dispatch' THEN abs(m.quantity) ELSE -abs(m.quantity) END) > 0;
$function$;

-- ---------------------------------------------------------------------------
-- C) Failure log table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_stock_dispatch_failures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid,
  order_number text,
  warehouse_id uuid,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  text
);
ALTER TABLE public.order_stock_dispatch_failures ADD COLUMN IF NOT EXISTS details jsonb;
ALTER TABLE public.order_stock_dispatch_failures ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1;
ALTER TABLE public.order_stock_dispatch_failures ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_stock_dispatch_failures_open
  ON public.order_stock_dispatch_failures(order_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_stock_dispatch_failures_order
  ON public.order_stock_dispatch_failures(order_id);
ALTER TABLE public.order_stock_dispatch_failures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_stock_dispatch_failures_read" ON public.order_stock_dispatch_failures;
CREATE POLICY "order_stock_dispatch_failures_read" ON public.order_stock_dispatch_failures
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['warehouse_supervisor','general_manager','executive_manager']::app_role[]));
REVOKE ALL ON public.order_stock_dispatch_failures FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_stock_dispatch_failures FROM authenticated;
GRANT SELECT ON public.order_stock_dispatch_failures TO authenticated;

CREATE OR REPLACE FUNCTION public._log_order_stock_dispatch_failure(
  p_order_id uuid, p_error text, p_details text DEFAULT NULL, p_notify boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order   record;
  v_id      uuid;
  v_details jsonb;
  v_reason  text;
  v_wh_name text;
BEGIN
  SELECT id, order_number, source_warehouse_id INTO v_order FROM public.orders WHERE id = p_order_id;

  BEGIN
    v_details := p_details::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_details := CASE WHEN p_details IS NULL THEN NULL ELSE to_jsonb(p_details) END;
  END;

  UPDATE public.order_stock_dispatch_failures
     SET error = p_error, details = v_details, attempts = attempts + 1, last_attempt_at = now(),
         order_number = COALESCE(v_order.order_number, order_number),
         warehouse_id = COALESCE(v_order.source_warehouse_id, warehouse_id)
   WHERE order_id = p_order_id AND resolved_at IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN v_id;  -- already open: no new notification (avoid spam)
  END IF;

  INSERT INTO public.order_stock_dispatch_failures(order_id, order_number, warehouse_id, error, details)
  VALUES (p_order_id, v_order.order_number, v_order.source_warehouse_id, p_error, v_details)
  RETURNING id INTO v_id;

  IF p_notify THEN
    v_reason := CASE WHEN position(' — ' IN COALESCE(p_error,'')) > 0
                     THEN substr(p_error, position(' — ' IN p_error) + 3)
                     ELSE COALESCE(p_error, 'خطأ غير معروف') END;
    SELECT name INTO v_wh_name FROM public.warehouses WHERE id = v_order.source_warehouse_id;

    INSERT INTO public.notifications(title, description, type, order_id, target_user_id)
    SELECT '⚠️ فشل خصم مخزون أوردر',
           'الأوردر ' || COALESCE(v_order.order_number, '-')
             || COALESCE(' (' || v_wh_name || ')', '')
             || ' تم تأكيد تسليمه لكن لم يتم خصم المخزون تلقائياً. السبب: ' || left(v_reason, 900),
           'stock_dispatch_failed', p_order_id, u.user_id
    FROM (SELECT DISTINCT ur.user_id FROM public.user_roles ur
          WHERE ur.role::text IN ('warehouse_supervisor','general_manager','executive_manager')) u;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._resolve_order_stock_dispatch_failures(p_order_id uuid, p_by text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  UPDATE public.order_stock_dispatch_failures
     SET resolved_at = now(), resolved_by = COALESCE(p_by, 'system')
   WHERE order_id = p_order_id AND resolved_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- Mark this order's still-active Agouza reservations as committed (stock already deducted by dispatch).
CREATE OR REPLACE FUNCTION public._commit_order_reservations_after_dispatch(p_order_id uuid, p_actor uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  UPDATE public.agouza_stock_reservations
     SET status = 'committed', committed_at = now(), committed_by = p_actor,
         notes = concat_ws(' | ', NULLIF(notes, ''), p_reason)
   WHERE order_id = p_order_id AND status = 'active';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    INSERT INTO public.agouza_reservation_audit_log(order_id, action, status_before, status_after, reason, details, success)
    VALUES (p_order_id, 'commit', 'active', 'committed', p_reason,
            jsonb_build_object('committed_count', v_n, 'via', 'order_stock_dispatch'), true);
  END IF;
  RETURN v_n;
END;
$function$;

-- Return (sales_return) whatever is still net-dispatched for an order. Returns # movements created.
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
  FOR r IN SELECT * FROM public._order_net_dispatched_items(p_order_id) LOOP
    SELECT id, warehouse_id, product_id, unit_cost, module INTO v_ii
      FROM public.inventory_items WHERE id = r.item_id FOR UPDATE;
    IF v_ii.id IS NULL THEN CONTINUE; END IF;

    UPDATE public.inventory_items
       SET stock = COALESCE(stock, 0) + r.net_qty, last_movement_date = now(), updated_at = now()
     WHERE id = v_ii.id;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
      reference_type, reference_id, module, reason, product_id, performed_by, approval_status
    ) VALUES (
      v_ii.id, COALESCE(r.warehouse_id, v_ii.warehouse_id), 'sales_return', r.net_qty,
      COALESCE(v_ii.unit_cost, 0), r.net_qty * COALESCE(v_ii.unit_cost, 0),
      'order', p_order_id::text, v_ii.module, p_reason, v_ii.product_id, auth.uid(), 'posted'
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Dispatch core (no auth requirement) + public wrapper with auth/role checks
-- ---------------------------------------------------------------------------
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
      performed_by, approval_status, module, product_id
    ) VALUES (
      v_inv.id, v_order.source_warehouse_id, v_order.source_warehouse_id,
      'sales_dispatch', v_item.qty, COALESCE(v_inv.unit_cost,0),
      v_item.qty * COALESCE(v_inv.unit_cost,0),
      'order', p_order_id::text,
      'صرف مبيعات', COALESCE(v_order.shipping_company,'—'),
      concat('صرف تلقائي للأوردر ', v_order.order_number, CASE WHEN p_note IS NOT NULL THEN ' — ' || p_note END),
      p_actor, 'posted', 'sales', v_item.product_id
    );

    UPDATE public.inventory_items
       SET stock = COALESCE(stock,0) - v_item.qty, last_movement_date = now(), updated_at = now()
     WHERE id = v_inv.id;

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

CREATE OR REPLACE FUNCTION public.dispatch_order_stock(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT (
    public.has_any_role(v_uid, ARRAY['general_manager','executive_manager','warehouse_supervisor','sales_manager','marketing_sales_manager','shipping_company','private_delivery_rep']::app_role[])
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED — هذا الإجراء لمسؤول المخزن أو الإدارة أو شركة الشحن فقط';
  END IF;

  RETURN public._dispatch_order_stock_core(p_order_id, v_uid, NULL, false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Order status trigger (A + B + C)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_order_status_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result           jsonb;
  v_was_dispatched   boolean;
  v_returned         integer := 0;
  v_is_manual        boolean;
  v_commit_resv      boolean := false;
  v_err              text;
  v_detail           text;
  v_new_stock_status text := NEW.stock_status;
  v_wh               uuid := COALESCE(NEW.source_warehouse_id, OLD.source_warehouse_id);
BEGIN
  v_is_manual      := COALESCE(public.is_manual_stock_warehouse(v_wh), false);
  v_was_dispatched := COALESCE(OLD.stock_status,'') = 'dispatched';

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    v_returned := public._return_order_dispatched_stock(NEW.id, 'إرجاع تلقائي عند إلغاء طلب مصروف');
    IF v_returned > 0 OR (v_was_dispatched AND NOT v_is_manual) THEN
      v_new_stock_status := 'returned';
    ELSIF NOT v_is_manual THEN
      v_new_stock_status := 'not_dispatched';
    END IF;
    PERFORM public._resolve_order_stock_dispatch_failures(NEW.id, 'system:order_cancelled');
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    IF COALESCE(OLD.stock_status,'') = 'returned' THEN
      v_new_stock_status := 'not_dispatched';
    END IF;
  END IF;

  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered'
     AND COALESCE(v_new_stock_status,'not_dispatched') <> 'dispatched'
     AND NEW.source_warehouse_id IS NOT NULL THEN
    BEGIN
      IF NEW.source_warehouse_id = 'a970d469-37df-40e1-b99f-a49195a3778e'::uuid THEN
        v_commit_resv := NOT COALESCE(public.can_operate_agouza_order(NEW.id, 'commit'), false);
      END IF;
      v_result := public._dispatch_order_stock_core(NEW.id, auth.uid(), NULL, v_commit_resv);
      IF v_result->>'status' IN ('dispatched','already_dispatched') THEN
        v_new_stock_status := 'dispatched';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
      BEGIN
        PERFORM public._log_order_stock_dispatch_failure(NEW.id, v_err, v_detail, true);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'order % stock dispatch failed (%); failure logging also failed: %', NEW.id, v_err, SQLERRM;
      END;
    END;
  END IF;

  IF v_new_stock_status IS DISTINCT FROM NEW.stock_status THEN
    UPDATE public.orders SET stock_status = v_new_stock_status
     WHERE id = NEW.id AND stock_status IS DISTINCT FROM v_new_stock_status;
  END IF;

  RETURN NULL;
END;
$function$;

-- Order delete: return what is still net-dispatched (no products.stock changes anymore)
CREATE OR REPLACE FUNCTION public.return_stock_on_order_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'cancelled' THEN RETURN OLD; END IF;
  PERFORM public._return_order_dispatched_stock(OLD.id, 'إرجاع تلقائي عند حذف طلب مصروف');
  RETURN OLD;
END;
$function$;

-- ---------------------------------------------------------------------------
-- B) Legacy products.stock deduction/toggles disabled
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_deduct_stock_on_order_item ON public.order_items;
DROP TRIGGER IF EXISTS trg_order_item_update ON public.order_items;
DROP TRIGGER IF EXISTS trg_order_item_delete ON public.order_items;

CREATE OR REPLACE FUNCTION public.deduct_stock_on_order_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Disabled 2026-09-26: stock is deducted from inventory_items on delivery only.
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_order_item_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Disabled 2026-09-26: legacy products.stock adjustment removed.
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_order_item_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Disabled 2026-09-26: legacy products.stock adjustment removed.
  RETURN OLD;
END;
$function$;

-- ---------------------------------------------------------------------------
-- D) Retry / backfill
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_failed_order_dispatches(p_since date DEFAULT '2026-09-19', p_dry_run boolean DEFAULT true)
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
  IF v_uid IS NOT NULL AND NOT public.has_any_role(v_uid, ARRAY['general_manager','executive_manager','warehouse_supervisor']::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  FOR r IN
    SELECT o.id, o.order_number, o.source_warehouse_id, o.delivered_at
    FROM public.orders o
    WHERE o.status = 'delivered'
      AND COALESCE(o.stock_status,'not_dispatched') <> 'dispatched'
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

-- ---------------------------------------------------------------------------
-- Privileges for new internal functions (callable only by postgres/service_role
-- or from other SECURITY DEFINER functions)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._main_wh_auto_dispatch_from() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._order_auto_dispatch_allowed(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._order_net_dispatched_items(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._log_order_stock_dispatch_failure(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._resolve_order_stock_dispatch_failures(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._commit_order_reservations_after_dispatch(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._return_order_dispatched_stock(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dispatch_order_stock_core(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_failed_order_dispatches(date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._main_wh_auto_dispatch_from() TO service_role;
GRANT EXECUTE ON FUNCTION public._order_auto_dispatch_allowed(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public._order_net_dispatched_items(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._log_order_stock_dispatch_failure(uuid, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public._resolve_order_stock_dispatch_failures(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._commit_order_reservations_after_dispatch(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._return_order_dispatched_stock(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._dispatch_order_stock_core(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_failed_order_dispatches(date, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- E) Barcodes (EAN-13, series 622400320 + item + check digit; next after ...829x)
-- ---------------------------------------------------------------------------
UPDATE public.products SET barcode = '6224003208308', updated_at = now()
 WHERE (id = '8b16cd04-ff86-4225-989d-b1cd5646062d' OR btrim(name) = 'دهن النعام')
   AND (barcode IS NULL OR btrim(barcode) = '')
   AND NOT EXISTS (SELECT 1 FROM public.products WHERE barcode = '6224003208308');

UPDATE public.products SET barcode = '6224003208315', updated_at = now()
 WHERE (id = 'd8bbbfcb-86fa-454d-943e-4108c8eacd69' OR btrim(name) = 'نخاع')
   AND (barcode IS NULL OR btrim(barcode) = '')
   AND NOT EXISTS (SELECT 1 FROM public.products WHERE barcode = '6224003208315');
