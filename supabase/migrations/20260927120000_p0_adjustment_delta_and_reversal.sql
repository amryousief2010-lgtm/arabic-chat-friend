-- P0 / 1 — Adjustment semantics
--
-- Design (safest for data already posted):
--   * adjustment / reconciliation with effect_mode = 'delta'  → stock += quantity
--     (quantity is the signed difference). New stocktakes and submit_stock_adjustment
--     use this so the ledger matches the card.
--   * adjustment / reconciliation with effect_mode NULL or 'set' → stock = quantity
--     (absolute target). This keeps Inventory Engine ("القيمة الجديدة") and any
--     historical replay of an absolute row behaving as they do today.
--   * Every posted movement records stock_before / stock_after. Reports must use
--     (stock_after - stock_before) as the real delta, never the raw absolute qty.
--   * opening_balance stays an ADD unless effect_mode = 'set' (opening approval).
--     The approval function no longer writes stock a second time.
--   * sales_dispatch is subtracted by the trigger; sales_return is added.
--     The order functions no longer update inventory_items.stock themselves
--     (that was a second writer and made delete/reverse a no-op).
--   * Delete / quantity-update reverses the signed effect. A legacy absolute
--     adjustment with no before/after snapshot cannot be reversed safely and raises.

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS stock_before numeric,
  ADD COLUMN IF NOT EXISTS stock_after numeric,
  ADD COLUMN IF NOT EXISTS effect_mode text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_movements_effect_mode_check'
  ) THEN
    ALTER TABLE public.inventory_movements
      ADD CONSTRAINT inventory_movements_effect_mode_check
      CHECK (effect_mode IS NULL OR effect_mode IN ('delta', 'set'));
  END IF;
END $$;

-- Backfill snapshots from the notes written by stocktake / submit_stock_adjustment.
UPDATE public.inventory_movements
   SET stock_before = (substring(notes from 'قبل=([0-9]+(?:\.[0-9]+)?)'))::numeric,
       stock_after  = (substring(notes from 'بعد=([0-9]+(?:\.[0-9]+)?)'))::numeric,
       effect_mode  = COALESCE(effect_mode, 'set')
 WHERE movement_type IN ('adjustment', 'reconciliation', 'adjust')
   AND stock_before IS NULL
   AND notes ~ 'قبل=[0-9]';

CREATE OR REPLACE FUNCTION public.inventory_movement_signed_effect(
  p_type text,
  p_qty numeric,
  p_effect_mode text,
  p_stock_before numeric,
  p_stock_after numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_stock_before IS NOT NULL AND p_stock_after IS NOT NULL
      THEN p_stock_after - p_stock_before
    WHEN p_type IN ('adjustment', 'reconciliation', 'adjust')
         AND COALESCE(p_effect_mode, 'set') <> 'delta'
      THEN NULL
    WHEN p_type = 'opening_balance' AND p_effect_mode = 'set'
      THEN NULL
    WHEN p_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return','opening_balance','sales_return')
      THEN abs(COALESCE(p_qty, 0))
    WHEN p_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss','transfer','sales_dispatch')
      THEN -abs(COALESCE(p_qty, 0))
    WHEN p_type IN ('adjustment', 'reconciliation', 'adjust') AND p_effect_mode = 'delta'
      THEN COALESCE(p_qty, 0)
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION public.inventory_movement_signed_effect(text, numeric, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_movement_signed_effect(text, numeric, text, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_old_cost numeric;
  v_new_cost numeric;
  v_reserved numeric;
  v_blocked numeric;
  v_allow_neg boolean := false;
  v_mode text;
  v_avail numeric;
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'posted' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_allow_neg := COALESCE(current_setting('app.allow_negative_stock', true), 'off') = 'on';
  EXCEPTION WHEN OTHERS THEN
    v_allow_neg := false;
  END;

  SELECT stock, unit_cost, COALESCE(reserved_qty, 0), COALESCE(blocked_qty, 0)
    INTO v_before, v_old_cost, v_reserved, v_blocked
  FROM public.inventory_items
  WHERE id = NEW.item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود';
  END IF;

  v_mode := NULLIF(btrim(COALESCE(NEW.effect_mode, '')), '');

  IF NEW.movement_type IN ('adjustment', 'reconciliation', 'adjust') AND v_mode = 'delta' THEN
    v_after := COALESCE(v_before, 0) + COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after, last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSIF NEW.movement_type IN ('adjustment', 'reconciliation', 'adjust') THEN
    v_after := COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after, last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSIF NEW.movement_type = 'opening_balance' AND v_mode = 'set' THEN
    v_after := COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after,
           unit_cost = CASE
             WHEN NEW.unit_cost IS NOT NULL AND NEW.unit_cost > 0 THEN NEW.unit_cost
             ELSE unit_cost
           END,
           last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSIF NEW.movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return','opening_balance','sales_return') THEN
    v_after := COALESCE(v_before, 0) + COALESCE(NEW.quantity, 0);
    IF NEW.unit_cost IS NOT NULL AND NEW.unit_cost > 0 AND COALESCE(NEW.quantity, 0) > 0 THEN
      v_new_cost := ((COALESCE(v_before, 0) * COALESCE(v_old_cost, 0)) + (NEW.quantity * NEW.unit_cost))
                    / NULLIF(COALESCE(v_before, 0) + NEW.quantity, 0);
      UPDATE public.inventory_items
         SET stock = v_after,
             unit_cost = COALESCE(v_new_cost, unit_cost),
             last_movement_date = now()
       WHERE id = NEW.item_id;
      IF v_old_cost IS DISTINCT FROM v_new_cost THEN
        INSERT INTO public.product_cost_history(module, target_table, target_id, old_cost, new_cost, reason, source, approved_by)
        VALUES (COALESCE(NEW.module, 'shared'), 'inventory_items', NEW.item_id::text,
                v_old_cost, v_new_cost, 'متوسط مرجح عند ' || NEW.movement_type, 'inv_post', NEW.performed_by);
      END IF;
    ELSE
      UPDATE public.inventory_items
         SET stock = v_after, last_movement_date = now()
       WHERE id = NEW.item_id;
    END IF;

  ELSIF NEW.movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss','transfer','sales_dispatch') THEN
    v_avail := COALESCE(v_before, 0) - v_reserved - v_blocked;
    IF v_avail < COALESCE(NEW.quantity, 0) AND NOT v_allow_neg THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_avail, NEW.quantity;
    END IF;
    v_after := COALESCE(v_before, 0) - COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after, last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSE
    v_after := v_before;
  END IF;

  UPDATE public.inventory_movements
     SET stock_before = v_before,
         stock_after = v_after,
         effect_mode = COALESCE(
           NEW.effect_mode,
           CASE
             WHEN NEW.movement_type IN ('adjustment', 'reconciliation', 'adjust') THEN 'set'
             ELSE 'delta'
           END
         )
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_inventory_movement_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_effect numeric;
BEGIN
  IF OLD.approval_status IS DISTINCT FROM 'posted' THEN
    RETURN OLD;
  END IF;

  v_effect := public.inventory_movement_signed_effect(
    OLD.movement_type, OLD.quantity, OLD.effect_mode, OLD.stock_before, OLD.stock_after
  );

  IF v_effect IS NULL THEN
    RAISE EXCEPTION 'لا يمكن حذف حركة تسوية أو رصيد افتتاحي بدون لقطة رصيد قبل وبعد (%)', OLD.id;
  END IF;

  IF v_effect <> 0 THEN
    UPDATE public.inventory_items
       SET stock = COALESCE(stock, 0) - v_effect,
           last_movement_date = now()
     WHERE id = OLD.item_id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_inventory_movement_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old numeric;
  v_new numeric;
  v_before numeric;
  v_mode text;
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'posted' OR OLD.approval_status IS DISTINCT FROM 'posted' THEN
    RETURN NEW;
  END IF;

  v_old := public.inventory_movement_signed_effect(
    OLD.movement_type, OLD.quantity, OLD.effect_mode, OLD.stock_before, OLD.stock_after
  );

  v_mode := COALESCE(NEW.effect_mode, OLD.effect_mode);

  IF NEW.movement_type IN ('adjustment', 'reconciliation', 'adjust')
     AND COALESCE(v_mode, 'set') <> 'delta' THEN
    IF OLD.stock_before IS NULL THEN
      RAISE EXCEPTION 'لا يمكن تعديل تسوية مطلقة بدون لقطة الرصيد قبل الحركة';
    END IF;
    v_new := COALESCE(NEW.quantity, 0) - OLD.stock_before;
    UPDATE public.inventory_items
       SET stock = COALESCE(stock, 0) - COALESCE(v_old, 0) + v_new,
           last_movement_date = now()
     WHERE id = NEW.item_id;
    UPDATE public.inventory_movements
       SET stock_before = OLD.stock_before,
           stock_after = OLD.stock_before + v_new,
           effect_mode = 'set'
     WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'لا يمكن تعديل هذه الحركة بدون لقطة رصيد قبل وبعد';
  END IF;

  -- Recompute the new effect from the new quantity, ignoring stale snapshots.
  v_new := public.inventory_movement_signed_effect(
    NEW.movement_type, NEW.quantity, v_mode, NULL, NULL
  );
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'لا يمكن تعديل هذه الحركة بدون لقطة رصيد قبل وبعد';
  END IF;

  IF NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    UPDATE public.inventory_items
       SET stock = COALESCE(stock, 0) - v_old, last_movement_date = now()
     WHERE id = OLD.item_id;
    SELECT stock INTO v_before FROM public.inventory_items WHERE id = NEW.item_id FOR UPDATE;
    UPDATE public.inventory_items
       SET stock = COALESCE(v_before, 0) + v_new, last_movement_date = now()
     WHERE id = NEW.item_id;
    UPDATE public.inventory_movements
       SET stock_before = v_before, stock_after = COALESCE(v_before, 0) + v_new
     WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  UPDATE public.inventory_items
     SET stock = COALESCE(stock, 0) - v_old + v_new,
         last_movement_date = now()
   WHERE id = NEW.item_id;

  UPDATE public.inventory_movements
     SET stock_after = COALESCE(OLD.stock_before, NEW.stock_before) + v_new
   WHERE id = NEW.id
     AND OLD.stock_before IS NOT NULL;

  RETURN NEW;
END;
$$;

-- Stocktake line: keep the original system_qty snapshot. Still refresh totals.
CREATE OR REPLACE FUNCTION public.upsert_stocktaking_line(
  p_session_id uuid,
  p_item_id uuid,
  p_actual_qty numeric,
  p_reason text,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.stocktaking_sessions%ROWTYPE;
  v_item public.inventory_items%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
    OR public.has_role(v_uid, 'warehouse_supervisor'::app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;
  IF p_actual_qty IS NULL OR p_actual_qty < 0 THEN
    RAISE EXCEPTION 'INVALID_QTY';
  END IF;

  SELECT * INTO v_session FROM public.stocktaking_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'SESSION_NOT_DRAFT'; END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_FOUND'; END IF;
  IF v_item.warehouse_id <> v_session.warehouse_id THEN
    RAISE EXCEPTION 'ITEM_WAREHOUSE_MISMATCH';
  END IF;

  INSERT INTO public.stocktaking_lines(
    session_id, item_id, system_qty, actual_qty, unit_cost, reason, notes, created_by
  ) VALUES (
    p_session_id, p_item_id, v_item.stock, p_actual_qty, COALESCE(v_item.unit_cost, 0),
    btrim(p_reason), p_notes, v_uid
  )
  ON CONFLICT (session_id, item_id) DO UPDATE
    SET actual_qty = EXCLUDED.actual_qty,
        reason     = EXCLUDED.reason,
        notes      = EXCLUDED.notes,
        updated_at = now()
  RETURNING id INTO v_id;

  UPDATE public.stocktaking_sessions s
     SET total_increase = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id AND diff > 0), 0),
         total_decrease = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id AND diff < 0), 0),
         net_value      = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id), 0)
   WHERE s.id = p_session_id;

  RETURN v_id;
END;
$$;

-- Approval posts the live difference (actual - stock now), not the absolute qty.
-- Header totals are recomputed from the frozen system_qty snapshot first.
-- executive_manager (المدير التنفيذي) and general_manager can approve.
CREATE OR REPLACE FUNCTION public.approve_stocktaking_session(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.stocktaking_sessions%ROWTYPE;
  v_ref text;
  v_line RECORD;
  v_delta numeric;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
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

  v_ref := 'stocktaking_' || v_session.session_no;

  FOR v_line IN
    SELECT l.*, i.stock AS current_stock
      FROM public.stocktaking_lines l
      JOIN public.inventory_items i ON i.id = l.item_id
     WHERE l.session_id = p_session_id
       AND (l.actual_qty - i.stock) <> 0
     FOR UPDATE OF i
  LOOP
    v_delta := v_line.actual_qty - v_line.current_stock;
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity, unit_cost,
      performed_by, performed_at, module, reference_type, reference_id,
      approval_status, reason, notes, approved_by, approved_at, effect_mode
    ) VALUES (
      v_line.item_id, v_session.warehouse_id, 'adjustment', v_delta, COALESCE(v_line.unit_cost, 0),
      v_uid, now(), 'warehouse', 'stocktaking', v_ref || '_' || v_line.item_id::text,
      'posted', v_line.reason,
      'تسوية جرد جلسة ' || v_session.session_no
        || ': قبل=' || v_line.current_stock
        || ' بعد=' || v_line.actual_qty
        || ' فرق=' || v_delta
        || ' لقطة_الجرد=' || v_line.system_qty,
      v_uid, now(), 'delta'
    );
  END LOOP;

  UPDATE public.stocktaking_sessions
     SET status = 'approved', approved_by = v_uid, approved_at = now(), reference_id = v_ref
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
  v_ref text;
  v_mov_id uuid;
  v_diff numeric;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
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

  v_ref := 'stock_adjustment_' || v_item.warehouse_id::text || '_' || p_item_id::text || '_' ||
           to_char(now(), 'YYYYMMDDHH24MISSMS');

  INSERT INTO public.inventory_movements(
    item_id, warehouse_id, movement_type, quantity, unit_cost,
    performed_by, performed_at, module, reference_type, reference_id,
    approval_status, reason, notes, approved_by, approved_at, effect_mode
  ) VALUES (
    p_item_id, v_item.warehouse_id, 'adjustment', v_diff, v_item.unit_cost,
    v_uid, now(), 'warehouse', 'stock_adjustment', v_ref,
    'posted', p_reason,
    'تسوية جرد: قبل=' || v_item.stock || ' بعد=' || p_actual_qty || ' فرق=' || v_diff,
    v_uid, now(), 'delta'
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

-- Opening approval sets the balance once (effect_mode = set). No second stock write.
CREATE OR REPLACE FUNCTION public.approve_warehouse_opening_balance(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ob public.warehouse_opening_balances%ROWTYPE;
  v_ref text;
  v_existing uuid;
  v_mov_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: فقط المدير العام أو المدير التنفيذي يعتمد الرصيد الافتتاحي';
  END IF;

  SELECT * INTO v_ob FROM public.warehouse_opening_balances WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_ob.status = 'approved' THEN RETURN v_ob.posted_movement_id; END IF;

  v_ref := 'opening_balance_' || v_ob.warehouse_id::text || '_' || v_ob.item_id::text || '_' ||
           to_char(COALESCE(v_ob.opened_at, now()), 'YYYYMMDD');

  SELECT id INTO v_existing FROM public.inventory_movements
   WHERE reference_id = v_ref AND movement_type = 'opening_balance' AND item_id = v_ob.item_id
   LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity, unit_cost,
      performed_by, performed_at, module, reference_type, reference_id,
      approval_status, notes, effect_mode
    ) VALUES (
      v_ob.item_id, v_ob.warehouse_id, 'opening_balance', v_ob.qty, COALESCE(v_ob.unit_cost, 0),
      v_uid, COALESCE(v_ob.opened_at, now()), 'warehouse', 'opening_balance', v_ref,
      'posted', COALESCE(v_ob.notes, '') || ' [opening_balance approved]', 'set'
    ) RETURNING id INTO v_mov_id;
  ELSE
    v_mov_id := v_existing;
  END IF;

  UPDATE public.warehouse_opening_balances
     SET status = 'approved', approved_by = v_uid, approved_at = now(),
         posted_movement_id = v_mov_id, updated_at = now()
   WHERE id = p_id;

  RETURN v_mov_id;
END;
$$;

-- Order dispatch: the trigger owns the stock change for sales_dispatch / sales_return.
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
      performed_by, approval_status, module, product_id, effect_mode
    ) VALUES (
      v_inv.id, v_order.source_warehouse_id, v_order.source_warehouse_id,
      'sales_dispatch', v_item.qty, COALESCE(v_inv.unit_cost,0),
      v_item.qty * COALESCE(v_inv.unit_cost,0),
      'order', p_order_id::text,
      'صرف مبيعات', COALESCE(v_order.shipping_company,'—'),
      concat('صرف تلقائي للأوردر ', v_order.order_number, CASE WHEN p_note IS NOT NULL THEN ' — ' || p_note END),
      p_actor, 'posted', 'sales', v_item.product_id, 'delta'
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
      reference_type, reference_id, product_id, module, reason, approval_status, effect_mode
    ) VALUES (
      r.inventory_item_id, v_agouza_wh, 'sales_dispatch', r.quantity, COALESCE(v_unit_cost, 0),
      'order', p_order_id::text, r.product_id, 'agouza_sales', 'تسليم أوردر عجوزة', 'posted', 'delta'
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
