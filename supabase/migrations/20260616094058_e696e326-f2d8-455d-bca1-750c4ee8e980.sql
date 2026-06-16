-- 1) New column for opening cost on prior-balance batches
ALTER TABLE public.slaughter_live_receipts
  ADD COLUMN IF NOT EXISTS opening_cost_total numeric NOT NULL DEFAULT 0;

-- 2) Include opening cost in the recalc total
CREATE OR REPLACE FUNCTION public.recalc_live_batch_cost(p_live_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_original_cost numeric := 0;
  v_opening_cost numeric := 0;
  v_bird_count integer := 0;
  v_doa integer := 0;
  v_feed_cost numeric := 0;
  v_mortality_count integer := 0;
  v_mortality_cost numeric := 0;
  v_other_cost numeric := 0;
  v_alive integer := 0;
  v_total numeric := 0;
  v_cpb numeric := 0;
BEGIN
  SELECT total_cost, COALESCE(opening_cost_total,0), bird_count,
         COALESCE(dead_on_arrival,0), COALESCE(other_costs_loaded,0)
    INTO v_original_cost, v_opening_cost, v_bird_count, v_doa, v_other_cost
  FROM public.slaughter_live_receipts WHERE id = p_live_batch_id;

  SELECT COALESCE(SUM(total_cost),0) INTO v_feed_cost
    FROM public.slaughter_ostrich_feed_consumption
   WHERE live_batch_id = p_live_batch_id AND reversed_at IS NULL;

  SELECT COALESCE(SUM(dead_count),0), COALESCE(SUM(total_loss_cost) FILTER (WHERE load_on_remaining),0)
    INTO v_mortality_count, v_mortality_cost
    FROM public.slaughter_live_mortality
   WHERE live_batch_id = p_live_batch_id AND reversed_at IS NULL;

  v_alive := GREATEST(v_bird_count - v_doa - v_mortality_count, 0);
  v_total := v_original_cost + v_opening_cost + v_feed_cost + v_other_cost;
  v_cpb := CASE WHEN v_alive > 0 THEN v_total / v_alive ELSE 0 END;

  UPDATE public.slaughter_live_receipts
     SET mortality_count = v_mortality_count,
         feed_cost_loaded = v_feed_cost,
         mortality_cost_loaded = v_mortality_cost,
         current_alive_count = v_alive,
         total_batch_cost = v_total,
         cost_per_bird_current = v_cpb,
         updated_at = now()
   WHERE id = p_live_batch_id;
END;
$function$;

-- 3) Secure RPC to set/update opening cost with audit
CREATE OR REPLACE FUNCTION public.set_opening_live_ostrich_cost(
  p_live_batch_id uuid,
  p_total_cost numeric,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old numeric := 0;
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_birds integer := 0;
BEGIN
  IF p_total_cost IS NULL OR p_total_cost < 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT COALESCE(opening_cost_total,0), bird_count
    INTO v_old, v_birds
    FROM public.slaughter_live_receipts
   WHERE id = p_live_batch_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch_not_found';
  END IF;

  v_is_admin := has_any_role(v_uid, ARRAY['general_manager'::app_role, 'executive_manager'::app_role]);

  -- First time set: also allow slaughterhouse_manager. Later edits: admins only.
  IF v_old > 0 AND NOT v_is_admin THEN
    RAISE EXCEPTION 'edit_requires_admin';
  END IF;
  IF v_old = 0 AND NOT (v_is_admin OR has_role(v_uid, 'slaughterhouse_manager'::app_role)) THEN
    RAISE EXCEPTION 'insert_requires_authorized_role';
  END IF;

  UPDATE public.slaughter_live_receipts
     SET opening_cost_total = p_total_cost,
         updated_at = now()
   WHERE id = p_live_batch_id;

  PERFORM recalc_live_batch_cost(p_live_batch_id);

  INSERT INTO public.slaughter_audit_log (
    action, target_type, target_id, performed_by,
    old_value, new_value, notes
  ) VALUES (
    CASE WHEN v_old = 0 THEN 'opening_cost_set' ELSE 'opening_cost_updated' END,
    'slaughter_live_receipts', p_live_batch_id, v_uid,
    jsonb_build_object('opening_cost_total', v_old),
    jsonb_build_object(
      'opening_cost_total', p_total_cost,
      'cost_per_bird', CASE WHEN v_birds > 0 THEN p_total_cost / v_birds ELSE 0 END,
      'bird_count', v_birds,
      'affects_treasury', false,
      'affects_inventory', false
    ),
    COALESCE(p_reason, 'إدخال/تعديل تكلفة افتتاحية للنعام الحي')
  );

  RETURN jsonb_build_object(
    'status','ok',
    'opening_cost_total', p_total_cost,
    'cost_per_bird', CASE WHEN v_birds > 0 THEN p_total_cost / v_birds ELSE 0 END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_opening_live_ostrich_cost(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_opening_live_ostrich_cost(uuid, numeric, text) TO authenticated;