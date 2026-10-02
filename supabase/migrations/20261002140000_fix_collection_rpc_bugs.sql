-- Fix three collection RPC/trigger bugs (2026-10-02 accounting review).
-- Does NOT change Zodex sync semantics (collection_status=collected on closed invoice
-- still means delivery/invoice closed, not cash in treasury).
-- Does NOT backfill historical orders or create remittance postings.

-- ---------------------------------------------------------------------------
-- Bug 1: record_courier_delivery_and_collection never synced orders collection fields
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_courier_delivery_and_collection(
  p_assignment_id uuid,
  p_amount_collected numeric DEFAULT NULL::numeric,
  p_notes text DEFAULT NULL::text,
  p_idempotency_key text DEFAULT NULL::text
)
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
  v_due numeric;
  v_amt numeric;
  v_collection_status text;
  v_order_collection_status text;
  v_assignment_status text;
  v_tracking_status text;
  v_reference text;
  v_existing_line_id uuid;
  v_line_id uuid;
BEGIN
  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'assignment_id is required';
  END IF;

  SELECT a.id, a.custody_id, a.order_id, a.courier_name, a.status
    INTO v_asn
  FROM public.courier_order_assignments a
  WHERE a.id = p_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'التعيين غير موجود'; END IF;
  IF v_asn.status IN ('fully_returned','cancelled') THEN
    RAISE EXCEPTION 'الأوردر مرتجع/ملغي ولا يمكن تسجيل تسليم له';
  END IF;

  v_courier    := v_asn.courier_name;
  v_custody_id := v_asn.custody_id;

  SELECT o.id, o.order_number, o.customer_id, o.total, o.status
    INTO v_order
  FROM public.orders o
  WHERE o.id = v_asn.order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الأوردر غير موجود'; END IF;

  v_due := COALESCE(v_order.total, 0);
  v_amt := COALESCE(p_amount_collected, 0);
  IF v_amt < 0 THEN RAISE EXCEPTION 'مبلغ غير صالح'; END IF;

  v_reference := 'DELIV-' || COALESCE(NULLIF(p_idempotency_key,''),
                  to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS') || '-' || substr(v_asn.id::text,1,6));

  SELECT id INTO v_existing_line_id
  FROM public.courier_goods_custody_lines
  WHERE order_id = v_asn.order_id
    AND line_type = 'sale'
    AND notes LIKE '%' || v_reference || '%'
  LIMIT 1;

  IF v_existing_line_id IS NOT NULL THEN
    RETURN jsonb_build_object('reference', v_reference,'line_id', v_existing_line_id,'idempotent_hit', true);
  END IF;

  IF v_amt = 0 THEN
    v_collection_status := 'not_collected';
    v_order_collection_status := 'not_collected';
    v_assignment_status := 'delivered';
    v_tracking_status   := 'delivered';
  ELSIF v_amt < v_due THEN
    v_collection_status := 'partial_collected';
    -- orders.collection_status historically only uses collected / not_collected
    v_order_collection_status := 'collected';
    v_assignment_status := 'delivered';
    v_tracking_status   := 'delivered';
  ELSE
    v_collection_status := 'cash_collected';
    v_order_collection_status := 'collected';
    v_assignment_status := 'completed';
    v_tracking_status   := 'collected';
  END IF;

  INSERT INTO public.courier_goods_custody_lines(
    custody_id, line_type, customer_id, customer_name, order_id,
    product_name, quantity, unit, unit_price, total_value, cash_collected,
    performed_at, performed_by, notes
  )
  SELECT
    v_custody_id, 'sale', v_order.customer_id, c.name, v_order.id,
    'أوردر ' || COALESCE(v_order.order_number,''), 1, 'أوردر', v_due, v_due, v_amt,
    now(), v_user,
    'تسليم وتحصيل — ' || v_reference || COALESCE(' | ' || NULLIF(p_notes,''), '')
  FROM (SELECT 1) x
  LEFT JOIN public.customers c ON c.id = v_order.customer_id
  RETURNING id INTO v_line_id;

  INSERT INTO public.pc_collections(
    order_id, amount_due, amount_collected, status, notes, collected_at, collected_by
  ) VALUES (
    v_order.id, v_due, v_amt, v_collection_status::pc_collection_status,
    p_notes, now(), v_user
  )
  ON CONFLICT (order_id) DO UPDATE SET
    amount_due = EXCLUDED.amount_due,
    amount_collected = EXCLUDED.amount_collected,
    status = EXCLUDED.status,
    notes = COALESCE(EXCLUDED.notes, public.pc_collections.notes),
    collected_at = EXCLUDED.collected_at,
    collected_by = EXCLUDED.collected_by,
    updated_at = now();

  UPDATE public.courier_order_assignments
     SET status = v_assignment_status,
         delivered_at = COALESCE(delivered_at, now()),
         collected_at = CASE WHEN v_amt >= v_due THEN now() ELSE collected_at END,
         notes = COALESCE(NULLIF(p_notes,''), notes),
         updated_at = now()
   WHERE id = p_assignment_id;

  INSERT INTO public.pc_order_tracking(order_id, courier_status, delivered_at, last_updated_by)
  VALUES (v_order.id, v_tracking_status::pc_courier_status, now(), v_user)
  ON CONFLICT (order_id) DO UPDATE SET
    courier_status = EXCLUDED.courier_status,
    delivered_at = COALESCE(public.pc_order_tracking.delivered_at, EXCLUDED.delivered_at),
    last_updated_by = EXCLUDED.last_updated_by,
    updated_at = now();

  -- FIX bug1: sync order collection fields.
  -- payment_status stays pending until remittance
  -- (deposit_courier_day_cash / PrivateDeliveryCollection) posts cash to treasury.
  UPDATE public.orders
     SET status = 'delivered',
         delivered_at = COALESCE(delivered_at, now()),
         delivered_by = COALESCE(delivered_by, v_user),
         total_at_delivery = COALESCE(total_at_delivery, v_due),
         collection_status = v_order_collection_status,
         collected_at = CASE
           WHEN v_amt > 0 THEN COALESCE(collected_at, now())
           ELSE collected_at
         END,
         collection_updated_at = now(),
         collection_updated_by = v_user,
         updated_at = now()
   WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'reference', v_reference,
    'line_id', v_line_id,
    'assignment_status', v_assignment_status,
    'collection_status', v_collection_status,
    'order_collection_status', v_order_collection_status,
    'amount_collected', v_amt,
    'amount_due', v_due,
    'idempotent_hit', false
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Bug 2: auto_main_warehouse_treasury_on_cash_collect only watched cash_collect.
-- Live custody lines are sale/issue/return only (0 cash_collect, 0 handover ever).
-- Canonical remittance that credits warehouse treasury is deposit_courier_day_cash
-- (status=posted) or submit_courier_cash_handover (pending_approval).
-- Sale lines mean cash is STILL WITH THE COURIER — auto-posting them would
-- double-count when the day deposit runs.
-- Fix: explicitly acknowledge sale (skip, no double-count) and keep cash_collect
-- → posted for legacy adjust/reject. Remittance money movement stays day-deposit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_main_warehouse_treasury_on_cash_collect()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_courier text;
  v_ref text;
  v_amount numeric;
BEGIN
  -- Live custody lines are sale/issue/return. Sale+cash means money is still with
  -- the courier; canonical treasury credit is deposit_courier_day_cash (posted) or
  -- submit_courier_cash_handover (pending_approval). Auto-posting sale would
  -- double-count against the day deposit — so sale is acknowledged and skipped.
  IF NEW.line_type = 'sale' THEN
    RETURN NEW;
  END IF;

  IF NEW.line_type <> 'cash_collect' THEN
    RETURN NEW;
  END IF;

  v_amount := COALESCE(NEW.cash_collected, 0);
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  v_ref := 'auto-line:' || NEW.id::text;

  IF EXISTS (SELECT 1 FROM public.main_warehouse_treasury_txns WHERE reference = v_ref) THEN
    RETURN NEW;
  END IF;

  SELECT courier_name INTO v_courier FROM public.courier_goods_custodies WHERE id = NEW.custody_id;

  INSERT INTO public.main_warehouse_treasury_txns(
    direction, category, amount, reference, notes, performed_by, status, courier_name, performed_at
  ) VALUES (
    'in', 'courier_deposit', v_amount, v_ref,
    'تحصيل تلقائي من سطر عهدة #' || NEW.id::text,
    NEW.performed_by, 'posted', v_courier, COALESCE(NEW.performed_at, now())
  );

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Bug 3: approve_courier_cash_handover required pending_approval while
-- deposit_courier_day_cash creates status=posted. Make approve idempotent for
-- already-posted courier deposits; pending_approval → posted on approve.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_courier_cash_handover(
  p_txn_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_txn RECORD;
BEGIN
  IF p_txn_id IS NULL THEN RAISE EXCEPTION 'txn_id is required'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user
      AND role IN ('financial_manager','main_treasury_approver','general_manager','admin')
  ) THEN
    RAISE EXCEPTION 'صلاحية غير كافية لاعتماد التوريد';
  END IF;

  SELECT * INTO v_txn FROM public.main_warehouse_treasury_txns
  WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحركة غير موجودة'; END IF;
  IF v_txn.category <> 'courier_deposit' THEN
    RAISE EXCEPTION 'هذه الحركة ليست توريد نقدية مندوب';
  END IF;

  -- Idempotent: day-deposit path already posts; treat posted/approved as success.
  IF v_txn.status IN ('posted', 'approved') THEN
    UPDATE public.main_warehouse_treasury_txns
    SET approved_by = COALESCE(approved_by, v_user),
        approved_at = COALESCE(approved_at, now()),
        notes = CASE
          WHEN NULLIF(p_note,'') IS NULL THEN notes
          ELSE COALESCE(notes,'') || ' | تأكيد اعتماد: ' || p_note
        END
    WHERE id = p_txn_id
      AND (approved_by IS NULL OR approved_at IS NULL OR NULLIF(p_note,'') IS NOT NULL);
    RETURN jsonb_build_object(
      'ok', true,
      'txn_id', p_txn_id,
      'amount', v_txn.amount,
      'idempotent', true,
      'status', v_txn.status
    );
  END IF;

  IF v_txn.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'هذه الحركة ليست بانتظار الاعتماد (الحالة: %)', v_txn.status;
  END IF;

  -- Approve pending (including sale markers or submit_courier_cash_handover rows)
  -- into posted so they count in treasury once cash is confirmed.
  UPDATE public.main_warehouse_treasury_txns
  SET status = 'posted',
      approved_by = v_user,
      approved_at = now(),
      notes = CASE
        WHEN NULLIF(p_note,'') IS NULL THEN notes
        ELSE COALESCE(notes,'') || ' | اعتماد: ' || p_note
      END
  WHERE id = p_txn_id;

  BEGIN
    INSERT INTO public.notifications(user_id, type, title, message, read)
    SELECT DISTINCT user_id, 'courier_cash_handover_approved',
      'تم اعتماد التوريد',
      'تم اعتماد توريد ' || v_txn.amount::text || ' ج.م من المندوب ' || COALESCE(v_txn.courier_name,''),
      false
    FROM public.user_roles
    WHERE role IN ('warehouse_manager','financial_manager');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'txn_id', p_txn_id, 'amount', v_txn.amount, 'idempotent', false);
END;
$$;

COMMENT ON FUNCTION public.record_courier_delivery_and_collection(uuid, numeric, text, text) IS
  'Delivery+collection for private courier; syncs orders.collection_status/collected_at; payment_status stays pending until remittance.';
COMMENT ON FUNCTION public.auto_main_warehouse_treasury_on_cash_collect() IS
  'Sale+cash skipped (cash at courier). cash_collect → posted. Day deposit remains canonical remittance.';
COMMENT ON FUNCTION public.approve_courier_cash_handover(uuid, text) IS
  'Approve pending courier_deposit to posted; idempotent if already posted/approved (day-deposit path).';
