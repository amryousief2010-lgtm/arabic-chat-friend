CREATE OR REPLACE FUNCTION public.apply_slaughter_cost_allocation(p_slaughter_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_birds_cost numeric := 0;
  v_birds_count integer := 0;
  v_direct numeric := 0;
  v_total_alloc numeric := 0;
  v_output_kg numeric := 0;
  v_cost_per_kg numeric := 0;
  v_done boolean;
  v_ref text;
  v_first_live uuid;
  v_sources_count int := 0;
BEGIN
  SELECT direct_slaughter_expenses, cost_allocation_done, cost_allocation_ref
    INTO v_direct, v_done, v_ref
  FROM public.slaughter_batches WHERE id = p_slaughter_batch_id
  FOR UPDATE;

  IF v_done THEN
    RETURN jsonb_build_object('status','already_allocated','ref',v_ref);
  END IF;

  -- Aggregate from multi-source table
  SELECT COALESCE(SUM(total_birds_cost),0), COALESCE(SUM(birds_count),0), COUNT(*)
    INTO v_birds_cost, v_birds_count, v_sources_count
  FROM public.slaughter_batch_live_sources
  WHERE slaughter_batch_id = p_slaughter_batch_id;

  IF v_sources_count = 0 THEN
    RAISE EXCEPTION 'لا يمكن توزيع التكلفة قبل تحديد مصادر النعام الداخل للدبح';
  END IF;

  SELECT COALESCE(SUM(actual_weight_kg),0) INTO v_output_kg
    FROM public.slaughter_batch_outputs WHERE batch_id = p_slaughter_batch_id;

  IF v_output_kg <= 0 THEN
    RAISE EXCEPTION 'لا يمكن توزيع التكلفة قبل إدخال نواتج الذبح';
  END IF;

  v_total_alloc := v_birds_cost + COALESCE(v_direct,0);
  v_cost_per_kg := v_total_alloc / v_output_kg;

  SELECT live_receipt_id INTO v_first_live
  FROM public.slaughter_batch_live_sources
  WHERE slaughter_batch_id = p_slaughter_batch_id
  ORDER BY created_at ASC LIMIT 1;

  UPDATE public.slaughter_batch_outputs
     SET unit_cost = v_cost_per_kg,
         total_cost = COALESCE(actual_weight_kg,0) * v_cost_per_kg
   WHERE batch_id = p_slaughter_batch_id;

  v_ref := 'slaughter_cost_allocation_' || p_slaughter_batch_id::text;
  UPDATE public.slaughter_batches
     SET cost_per_bird_snapshot = CASE WHEN v_birds_count>0 THEN v_birds_cost/v_birds_count ELSE 0 END,
         total_birds_cost = v_birds_cost,
         total_allocatable_cost = v_total_alloc,
         cost_per_kg_meat = v_cost_per_kg,
         cost_allocation_done = true,
         cost_allocation_ref = v_ref,
         updated_at = now()
   WHERE id = p_slaughter_batch_id;

  INSERT INTO public.slaughter_batch_cost_breakdown
    (slaughter_batch_id, live_batch_id, birds_count,
     birds_original_cost, feed_cost, mortality_cost, other_costs,
     direct_expenses, total_cost, total_output_kg, cost_per_kg)
  VALUES
    (p_slaughter_batch_id, v_first_live, v_birds_count,
     v_birds_cost, 0, 0, 0,
     COALESCE(v_direct,0), v_total_alloc, v_output_kg, v_cost_per_kg)
  ON CONFLICT (slaughter_batch_id) DO UPDATE
    SET live_batch_id = EXCLUDED.live_batch_id,
        birds_count = EXCLUDED.birds_count,
        birds_original_cost = EXCLUDED.birds_original_cost,
        feed_cost = 0,
        mortality_cost = 0,
        other_costs = 0,
        direct_expenses = EXCLUDED.direct_expenses,
        total_cost = EXCLUDED.total_cost,
        total_output_kg = EXCLUDED.total_output_kg,
        cost_per_kg = EXCLUDED.cost_per_kg,
        updated_at = now();

  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES
    ('cost_allocation', 'slaughter_batch', p_slaughter_batch_id, p_slaughter_batch_id, auth.uid(),
     jsonb_build_object(
       'birds_cost_total', v_birds_cost,
       'birds_count', v_birds_count,
       'direct_expenses_total', COALESCE(v_direct,0),
       'total_cost_to_allocate', v_total_alloc,
       'total_output_kg', v_output_kg,
       'cost_per_kg', v_cost_per_kg,
       'sources_count', v_sources_count
     ),
     'توزيع تكلفة نواتج الذبح من slaughter_batch_live_sources');

  RETURN jsonb_build_object(
    'status','ok',
    'cost_per_kg', v_cost_per_kg,
    'birds_cost_total', v_birds_cost,
    'direct_expenses_total', COALESCE(v_direct,0),
    'total_cost', v_total_alloc,
    'output_kg', v_output_kg,
    'sources_count', v_sources_count,
    'ref', v_ref
  );
END;
$function$;