-- 1) Restrict warehouse_supervisor to inventory_items only
CREATE OR REPLACE FUNCTION public.mr_reconcile_negative_stock(p_task_id uuid, p_target_table text, p_target_id text, p_new_stock numeric, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_old numeric; v_task public.data_quality_tasks%ROWTYPE; v_admin boolean;
BEGIN
  v_admin := public.mr_can_admin(auth.uid());
  IF NOT public.mr_can_reconcile_stock(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_task_id IS NULL THEN RAISE EXCEPTION 'TASK_REQUIRED'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF p_new_stock IS NULL THEN RAISE EXCEPTION 'INVALID_VALUE'; END IF;

  SELECT * INTO v_task FROM public.data_quality_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND'; END IF;
  IF v_task.status NOT IN ('open','in_progress') THEN RAISE EXCEPTION 'TASK_NOT_OPEN'; END IF;
  IF v_task.task_type <> 'negative_stock' THEN RAISE EXCEPTION 'TASK_TYPE_MISMATCH'; END IF;
  IF v_task.reference_table IS DISTINCT FROM p_target_table
     OR v_task.reference_id IS DISTINCT FROM p_target_id THEN
    RAISE EXCEPTION 'TARGET_MISMATCH';
  END IF;

  IF NOT v_admin THEN
    -- warehouse_supervisor: inventory_items only, warehouse module only
    IF v_task.module <> 'warehouse' THEN RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_TARGET'; END IF;
    IF p_target_table <> 'inventory_items' THEN RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_TARGET'; END IF;
  END IF;

  IF p_target_table NOT IN ('meat_factory_raw_materials','feed_raw_materials','inventory_items','products') THEN
    RAISE EXCEPTION 'INVALID_TARGET';
  END IF;

  IF p_target_table='meat_factory_raw_materials' THEN
    SELECT stock INTO v_old FROM public.meat_factory_raw_materials WHERE material_code=p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    UPDATE public.meat_factory_raw_materials SET stock=p_new_stock, updated_at=now() WHERE material_code=p_target_id;
  ELSIF p_target_table='feed_raw_materials' THEN
    SELECT stock INTO v_old FROM public.feed_raw_materials WHERE material_code=p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    UPDATE public.feed_raw_materials SET stock=p_new_stock, updated_at=now() WHERE material_code=p_target_id;
  ELSIF p_target_table='inventory_items' THEN
    SELECT stock INTO v_old FROM public.inventory_items WHERE id=p_target_id::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    UPDATE public.inventory_items SET stock=p_new_stock, updated_at=now() WHERE id=p_target_id::uuid;
    INSERT INTO public.inventory_movements(item_id, warehouse_id, movement_type, quantity, reference, party, performed_by, notes)
    SELECT id, warehouse_id, 'adjustment', p_new_stock, 'تسوية مراجعة مدير', 'Manager Review', auth.uid(), p_reason
      FROM public.inventory_items WHERE id=p_target_id::uuid;
  ELSIF p_target_table='products' THEN
    SELECT stock INTO v_old FROM public.products WHERE id=p_target_id::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    UPDATE public.products SET stock=p_new_stock::int, updated_at=now() WHERE id=p_target_id::uuid;
  END IF;

  UPDATE public.data_quality_tasks SET status='resolved', resolved_by=auth.uid(), resolved_at=now(), resolution_notes=p_reason
    WHERE id=p_task_id;

  INSERT INTO public.manager_review_audit(task_id, action, module, target_table, target_id, old_value, new_value, reason, performed_by)
  VALUES (p_task_id, 'reconcile_stock', v_task.module, p_target_table, p_target_id,
          jsonb_build_object('stock', v_old), jsonb_build_object('stock', p_new_stock), p_reason, auth.uid());

  RETURN jsonb_build_object('success', true, 'old', v_old, 'new', p_new_stock);
END $function$;

REVOKE ALL ON FUNCTION public.mr_reconcile_negative_stock(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mr_reconcile_negative_stock(uuid, text, text, numeric, text) TO authenticated;

-- 2) Block direct inserts into product_cost_history (RPC/SECURITY DEFINER only)
DROP POLICY IF EXISTS "pch_insert_approvers" ON public.product_cost_history;
DROP POLICY IF EXISTS "pch_insert_authorized" ON public.product_cost_history;
REVOKE INSERT, UPDATE, DELETE ON public.product_cost_history FROM authenticated;
REVOKE ALL ON public.product_cost_history FROM anon;
GRANT SELECT ON public.product_cost_history TO authenticated;
GRANT ALL ON public.product_cost_history TO service_role;