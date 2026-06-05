
CREATE OR REPLACE FUNCTION public.finalize_slaughter_batch(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch public.slaughter_batches%ROWTYPE;
  v_old   public.slaughter_batches%ROWTYPE;
  v_meat numeric := 0;
  v_total_purchase numeric := 0;
  v_cost_per_kg numeric := 0;
  v_transfers int := 0;
  v_yield_pct numeric := 0;
BEGIN
  SELECT * INTO v_batch FROM public.slaughter_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  v_old := v_batch;

  SELECT COALESCE(SUM(actual_weight_kg),0) INTO v_meat
  FROM public.slaughter_batch_outputs WHERE batch_id = p_batch_id;

  IF v_batch.live_receipt_id IS NOT NULL THEN
    SELECT COALESCE(total_cost,0) + COALESCE((
      SELECT SUM(feed_cost) FROM public.slaughter_live_birds WHERE receipt_id = v_batch.live_receipt_id
    ),0) INTO v_total_purchase
    FROM public.slaughter_live_receipts WHERE id = v_batch.live_receipt_id;
  END IF;

  IF v_meat > 0 THEN v_cost_per_kg := v_total_purchase / v_meat; END IF;
  IF v_batch.total_live_weight_kg > 0 THEN
    v_yield_pct := (v_meat / v_batch.total_live_weight_kg) * 100;
  END IF;

  UPDATE public.slaughter_batches
  SET total_meat_kg = v_meat,
      cost_per_kg_meat = v_cost_per_kg,
      status = 'completed',
      end_time = COALESCE(end_time, CURRENT_TIME)
  WHERE id = p_batch_id;

  UPDATE public.slaughter_batch_outputs
  SET unit_cost = v_cost_per_kg
  WHERE batch_id = p_batch_id;

  INSERT INTO public.slaughter_branch_transfers (batch_id, output_id, branch_id, cut_name_ar, weight_kg, unit_price)
  SELECT o.batch_id, o.id, o.branch_id, o.cut_name_ar, o.actual_weight_kg, o.unit_price
  FROM public.slaughter_batch_outputs o
  WHERE o.batch_id = p_batch_id
    AND o.branch_id IS NOT NULL
    AND o.actual_weight_kg > 0
    AND NOT EXISTS (SELECT 1 FROM public.slaughter_branch_transfers t WHERE t.output_id = o.id);
  GET DIAGNOSTICS v_transfers = ROW_COUNT;

  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, old_value, new_value, notes)
  VALUES
    ('finalize_batch', 'batch', p_batch_id, p_batch_id, auth.uid(),
     jsonb_build_object(
       'status', v_old.status,
       'total_meat_kg', v_old.total_meat_kg,
       'actual_yield_pct', v_old.actual_yield_pct,
       'cost_per_kg_meat', v_old.cost_per_kg_meat
     ),
     jsonb_build_object(
       'status', 'completed',
       'total_meat_kg', v_meat,
       'actual_yield_pct', v_yield_pct,
       'cost_per_kg_meat', v_cost_per_kg,
       'total_purchase_cost', v_total_purchase,
       'transfers_created', v_transfers
     ),
     'Finalized batch ' || v_batch.batch_number
       || ' — yield ' || to_char(v_yield_pct, 'FM999990.0') || '%'
       || ', ' || v_transfers || ' transfers');

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'total_meat_kg', v_meat,
    'total_purchase_cost', v_total_purchase,
    'cost_per_kg_meat', v_cost_per_kg,
    'actual_yield_pct', v_yield_pct,
    'transfers_created', v_transfers
  );
END;
$function$;
