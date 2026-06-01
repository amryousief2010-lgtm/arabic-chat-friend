
-- 1) Yield standards: add minimum acceptable yield
ALTER TABLE public.slaughter_yield_standards
  ADD COLUMN IF NOT EXISTS min_acceptable_yield_pct numeric;

-- 2) Slaughter batches: approval columns
ALTER TABLE public.slaughter_batches
  ADD COLUMN IF NOT EXISTS transfer_status text DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS low_yield_approval_by uuid,
  ADD COLUMN IF NOT EXISTS low_yield_approval_at timestamptz,
  ADD COLUMN IF NOT EXISTS low_yield_approval_note text,
  ADD COLUMN IF NOT EXISTS low_yield_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS low_yield_requested_by uuid;

-- ============================================================
-- 3) Summary RPC: live balance + monthly stats
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_slaughterhouse_summary(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_birds_received int := 0;
  v_total_dead_on_arrival int := 0;
  v_total_birds_slaughtered int := 0;
  v_total_pre_slaughter_dead int := 0;
  v_total_rejected int := 0;

  v_period_birds_slaughtered int := 0;
  v_period_live_weight numeric := 0;
  v_period_meat numeric := 0;
  v_period_cost numeric := 0;

  v_outputs jsonb := '[]'::jsonb;
BEGIN
  -- Lifetime totals (for the standing balance)
  SELECT COALESCE(SUM(bird_count),0), COALESCE(SUM(dead_on_arrival),0)
    INTO v_total_birds_received, v_total_dead_on_arrival
  FROM public.slaughter_live_receipts;

  SELECT COALESCE(SUM(birds_slaughtered),0),
         COALESCE(SUM(pre_slaughter_dead),0),
         COALESCE(SUM(rejected_birds),0)
    INTO v_total_birds_slaughtered, v_total_pre_slaughter_dead, v_total_rejected
  FROM public.slaughter_batches
  WHERE status <> 'cancelled';

  -- Period stats
  SELECT COALESCE(SUM(birds_slaughtered),0),
         COALESCE(SUM(total_live_weight_kg),0),
         COALESCE(SUM(total_meat_kg),0)
    INTO v_period_birds_slaughtered, v_period_live_weight, v_period_meat
  FROM public.slaughter_batches
  WHERE status <> 'cancelled'
    AND (p_from IS NULL OR slaughter_date >= p_from)
    AND (p_to   IS NULL OR slaughter_date <= p_to);

  -- Period cost (from outputs)
  SELECT COALESCE(SUM(o.total_cost),0)
    INTO v_period_cost
  FROM public.slaughter_batch_outputs o
  JOIN public.slaughter_batches b ON b.id = o.batch_id
  WHERE b.status <> 'cancelled'
    AND (p_from IS NULL OR b.slaughter_date >= p_from)
    AND (p_to   IS NULL OR b.slaughter_date <= p_to);

  -- Outputs breakdown for period
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_outputs FROM (
    SELECT
      o.cut_name_ar AS cut_name,
      SUM(o.actual_weight_kg) AS total_kg,
      SUM(o.package_count)    AS total_packages,
      SUM(o.total_cost)       AS total_cost
    FROM public.slaughter_batch_outputs o
    JOIN public.slaughter_batches b ON b.id = o.batch_id
    WHERE b.status <> 'cancelled'
      AND (p_from IS NULL OR b.slaughter_date >= p_from)
      AND (p_to   IS NULL OR b.slaughter_date <= p_to)
    GROUP BY o.cut_name_ar
    ORDER BY SUM(o.actual_weight_kg) DESC
  ) t;

  RETURN jsonb_build_object(
    'live_balance', GREATEST(
      v_total_birds_received
      - v_total_dead_on_arrival
      - v_total_birds_slaughtered
      - v_total_pre_slaughter_dead
      - v_total_rejected, 0
    ),
    'lifetime', jsonb_build_object(
      'received', v_total_birds_received,
      'dead_on_arrival', v_total_dead_on_arrival,
      'slaughtered', v_total_birds_slaughtered,
      'pre_slaughter_dead', v_total_pre_slaughter_dead,
      'rejected', v_total_rejected
    ),
    'period', jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'birds_slaughtered', v_period_birds_slaughtered,
      'live_weight_kg',  v_period_live_weight,
      'meat_kg',         v_period_meat,
      'total_cost',      v_period_cost,
      'avg_yield_pct',   CASE WHEN v_period_live_weight > 0
                              THEN (v_period_meat / v_period_live_weight) * 100
                              ELSE 0 END,
      'outputs_breakdown', v_outputs
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_slaughterhouse_summary(date, date) TO authenticated, service_role;

-- ============================================================
-- 4) Request transfer to main warehouse (with low-yield gate)
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_slaughter_transfer_to_main(
  p_batch_id uuid,
  p_warehouse_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.slaughter_batches%ROWTYPE;
  v_total_meat numeric := 0;
  v_actual_yield numeric := 0;
  v_min_total_yield numeric := 0;
  v_low boolean := false;
  v_needs_approval boolean := false;
  v_is_manager boolean;
  v_recv jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_batch FROM public.slaughter_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;

  -- Compute actual yield (meat only) and minimum allowed (sum of meat-category mins)
  SELECT COALESCE(SUM(o.actual_weight_kg),0) INTO v_total_meat
  FROM public.slaughter_batch_outputs o
  WHERE o.batch_id = p_batch_id;

  IF v_batch.total_live_weight_kg > 0 THEN
    v_actual_yield := (v_total_meat / v_batch.total_live_weight_kg) * 100;
  END IF;

  SELECT COALESCE(SUM(COALESCE(min_acceptable_yield_pct, standard_yield_pct)),0)
    INTO v_min_total_yield
  FROM public.slaughter_yield_standards
  WHERE is_active = true AND category <> 'waste'
    AND COALESCE(min_acceptable_yield_pct, standard_yield_pct) IS NOT NULL;

  v_low := (v_min_total_yield > 0 AND v_actual_yield < v_min_total_yield);

  v_is_manager := public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role, 'executive_manager'::app_role
  ]);

  -- If yield is low AND user is NOT a manager AND no approval yet => block & mark pending
  v_needs_approval := v_low AND NOT v_is_manager AND v_batch.transfer_status <> 'approved';

  IF v_needs_approval THEN
    UPDATE public.slaughter_batches
       SET transfer_status = 'pending_approval',
           low_yield_requested_at = now(),
           low_yield_requested_by = auth.uid()
     WHERE id = p_batch_id;
    RETURN jsonb_build_object(
      'success', false,
      'needs_approval', true,
      'actual_yield_pct', v_actual_yield,
      'min_required_pct', v_min_total_yield,
      'message', 'التصافي أقل من الحد المسموح — بانتظار موافقة الإدارة'
    );
  END IF;

  -- Proceed with transfer
  v_recv := public.receive_slaughter_batch(p_batch_id, p_warehouse_id);

  UPDATE public.slaughter_batches
     SET transfer_status = 'transferred'
   WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'needs_approval', false,
    'actual_yield_pct', v_actual_yield,
    'min_required_pct', v_min_total_yield,
    'low_yield', v_low,
    'receive', v_recv
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_slaughter_transfer_to_main(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 5) Approve low-yield transfer (manager only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_low_yield_transfer(
  p_batch_id uuid,
  p_warehouse_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recv jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role, 'executive_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: فقط المدير العام أو التنفيذي';
  END IF;

  UPDATE public.slaughter_batches
     SET transfer_status = 'approved',
         low_yield_approval_by = auth.uid(),
         low_yield_approval_at = now(),
         low_yield_approval_note = p_note
   WHERE id = p_batch_id;

  v_recv := public.receive_slaughter_batch(p_batch_id, p_warehouse_id);

  UPDATE public.slaughter_batches
     SET transfer_status = 'transferred'
   WHERE id = p_batch_id;

  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES
    ('approve_low_yield_transfer','batch', p_batch_id, p_batch_id, auth.uid(),
     jsonb_build_object('warehouse_id', p_warehouse_id, 'note', p_note),
     COALESCE(p_note,'موافقة على تصافي منخفض'));

  RETURN jsonb_build_object('success', true, 'receive', v_recv);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_low_yield_transfer(uuid, uuid, text) TO authenticated, service_role;

-- ============================================================
-- 6) Reject low-yield transfer (manager only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.reject_low_yield_transfer(
  p_batch_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role, 'executive_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE public.slaughter_batches
     SET transfer_status = 'rejected',
         low_yield_approval_by = auth.uid(),
         low_yield_approval_at = now(),
         low_yield_approval_note = p_reason
   WHERE id = p_batch_id;

  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES
    ('reject_low_yield_transfer','batch', p_batch_id, p_batch_id, auth.uid(),
     jsonb_build_object('reason', p_reason), p_reason);

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_low_yield_transfer(uuid, text) TO authenticated, service_role;

-- ============================================================
-- 7) Partial transfer to meat factory
--    p_items: [{ output_id uuid, kg_to_meat numeric }, ...]
-- ============================================================
CREATE OR REPLACE FUNCTION public.transfer_outputs_to_meat_factory(
  p_batch_id uuid,
  p_meat_warehouse_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_out public.slaughter_batch_outputs%ROWTYPE;
  v_kg numeric;
  v_pkg int;
  v_new_id uuid;
  v_count int := 0;
  v_total_kg numeric := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_kg := COALESCE((v_item->>'kg_to_meat')::numeric, 0);
    IF v_kg <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_out FROM public.slaughter_batch_outputs
      WHERE id = (v_item->>'output_id')::uuid AND batch_id = p_batch_id
      FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_kg > v_out.actual_weight_kg THEN
      RAISE EXCEPTION 'الكمية المطلوب نقلها (%) أكبر من المتاح (%) لـ %', v_kg, v_out.actual_weight_kg, v_out.cut_name_ar;
    END IF;

    -- Proportional packages
    v_pkg := CASE WHEN v_out.actual_weight_kg > 0
                  THEN ROUND(v_out.package_count * (v_kg / v_out.actual_weight_kg))
                  ELSE 0 END;

    -- Reduce the original (which will go to main warehouse)
    UPDATE public.slaughter_batch_outputs
       SET actual_weight_kg = actual_weight_kg - v_kg,
           package_count = GREATEST(package_count - v_pkg, 0),
           total_cost = (actual_weight_kg - v_kg) * COALESCE(unit_cost,0)
     WHERE id = v_out.id;

    -- Create a new output row routed to meat factory
    INSERT INTO public.slaughter_batch_outputs(
      batch_id, yield_standard_id, cut_name_ar, barcode, product_id,
      actual_weight_kg, package_count, standard_weight_kg, variance_kg, variance_pct,
      unit_cost, total_cost, expiry_date, destination, notes, branch_id, unit_price,
      received_status, quality_status
    ) VALUES (
      v_out.batch_id, v_out.yield_standard_id, v_out.cut_name_ar, v_out.barcode, v_out.product_id,
      v_kg, v_pkg, NULL, NULL, NULL,
      v_out.unit_cost, v_kg * COALESCE(v_out.unit_cost,0),
      v_out.expiry_date, 'meat_factory',
      COALESCE(v_out.notes,'') || ' [نقل لمصنع اللحوم]',
      NULL, v_out.unit_price, 'pending', v_out.quality_status
    ) RETURNING id INTO v_new_id;

    -- Receive the new row into the meat factory warehouse
    PERFORM public.receive_slaughter_output(v_new_id, p_meat_warehouse_id);

    v_count := v_count + 1;
    v_total_kg := v_total_kg + v_kg;
  END LOOP;

  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES
    ('transfer_to_meat_factory','batch', p_batch_id, p_batch_id, auth.uid(),
     jsonb_build_object('items', p_items, 'meat_warehouse_id', p_meat_warehouse_id),
     format('نقل %s صنف إلى مصنع اللحوم (%.2f كجم)', v_count, v_total_kg));

  RETURN jsonb_build_object('success', true, 'count', v_count, 'total_kg', v_total_kg);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_outputs_to_meat_factory(uuid, uuid, jsonb) TO authenticated, service_role;
