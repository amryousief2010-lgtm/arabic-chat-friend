-- ============================================================
-- Phase 4: Manager Review Center hardening
-- New helpers (do NOT touch public.can_manage_review — used elsewhere)
-- ============================================================

CREATE OR REPLACE FUNCTION public.mr_can_admin(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND public.has_any_role(_uid, ARRAY['general_manager','executive_manager']::app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.mr_can_reconcile_stock(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND public.has_any_role(_uid, ARRAY['general_manager','executive_manager','warehouse_supervisor']::app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.mr_can_approve_cost(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND public.has_any_role(_uid, ARRAY['general_manager','executive_manager','accountant','financial_manager','cost_accountant']::app_role[]);
$$;

-- View scope helper: role x module x task_type
CREATE OR REPLACE FUNCTION public.mr_can_view_task(_uid uuid, _module text, _task_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.has_any_role(_uid, ARRAY['general_manager','executive_manager']::app_role[])
    OR public.has_any_role(_uid, ARRAY['production_manager']::app_role[])
    OR (public.has_any_role(_uid, ARRAY['meat_factory_manager']::app_role[]) AND _module = 'meat')
    OR (public.has_any_role(_uid, ARRAY['feed_factory_manager']::app_role[]) AND _module = 'feed')
    OR (public.has_any_role(_uid, ARRAY['quality_manager']::app_role[]) AND _module IN ('meat','feed','shared'))
    OR (public.has_any_role(_uid, ARRAY['warehouse_supervisor']::app_role[]) AND _module = 'warehouse')
    OR (public.has_any_role(_uid, ARRAY['accountant','financial_manager','cost_accountant']::app_role[]) AND _task_type = 'cost_review')
  );
$$;

REVOKE ALL ON FUNCTION public.mr_can_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mr_can_reconcile_stock(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mr_can_approve_cost(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mr_can_view_task(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mr_can_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mr_can_reconcile_stock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mr_can_approve_cost(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mr_can_view_task(uuid, text, text) TO authenticated;

-- ============================================================
-- mr_assign_barcode — GM / Exec only, strictly bound to the task
-- ============================================================
CREATE OR REPLACE FUNCTION public.mr_assign_barcode(p_task_id uuid, p_product_id uuid, p_barcode text, p_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_old text; v_exists boolean; v_task public.data_quality_tasks%ROWTYPE;
BEGIN
  IF NOT public.mr_can_admin(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_task_id IS NULL THEN RAISE EXCEPTION 'TASK_REQUIRED'; END IF;
  IF p_product_id IS NULL THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
  IF p_barcode IS NULL OR length(trim(p_barcode)) = 0 THEN RAISE EXCEPTION 'BARCODE_REQUIRED'; END IF;

  SELECT * INTO v_task FROM public.data_quality_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND'; END IF;
  IF v_task.status NOT IN ('open','in_progress') THEN RAISE EXCEPTION 'TASK_NOT_OPEN'; END IF;
  IF v_task.task_type <> 'missing_barcode' THEN RAISE EXCEPTION 'TASK_TYPE_MISMATCH'; END IF;
  IF v_task.reference_table <> 'products' OR v_task.reference_id IS NULL
     OR v_task.reference_id <> p_product_id::text THEN
    RAISE EXCEPTION 'TARGET_MISMATCH';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.products WHERE barcode = trim(p_barcode) AND id <> p_product_id) INTO v_exists;
  IF v_exists THEN RAISE EXCEPTION 'BARCODE_DUPLICATE'; END IF;

  SELECT barcode INTO v_old FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;

  UPDATE public.products
    SET barcode = trim(p_barcode), is_active = true, updated_at = now()
    WHERE id = p_product_id;

  UPDATE public.data_quality_tasks
    SET status='resolved', resolved_by=auth.uid(), resolved_at=now(),
        resolution_notes=COALESCE(p_reason,'تم تعيين باركود')
    WHERE id = p_task_id;

  INSERT INTO public.manager_review_audit(task_id, action, module, target_table, target_id, old_value, new_value, reason, performed_by)
  VALUES (p_task_id, 'assign_barcode', COALESCE(v_task.module,'shared'), 'products', p_product_id::text,
          jsonb_build_object('barcode', v_old),
          jsonb_build_object('barcode', trim(p_barcode), 'is_active', true),
          p_reason, auth.uid());

  RETURN jsonb_build_object('success', true);
END $function$;

-- ============================================================
-- mr_reconcile_negative_stock — GM / Exec / warehouse_supervisor (warehouse scope)
-- ============================================================
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
    -- warehouse_supervisor: warehouse module only, no factory/cost tables
    IF v_task.module <> 'warehouse' THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    IF p_target_table NOT IN ('inventory_items','products') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
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

-- ============================================================
-- mr_approve_cost — GM / Exec / accountant / financial_manager / cost_accountant
-- ============================================================
CREATE OR REPLACE FUNCTION public.mr_approve_cost(p_task_id uuid, p_module text, p_target_table text, p_target_id text, p_new_cost numeric, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_old numeric; v_code text; v_task public.data_quality_tasks%ROWTYPE;
BEGIN
  IF NOT public.mr_can_approve_cost(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_task_id IS NULL THEN RAISE EXCEPTION 'TASK_REQUIRED'; END IF;
  IF p_new_cost IS NULL OR p_new_cost <= 0 THEN RAISE EXCEPTION 'INVALID_COST'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_task FROM public.data_quality_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND'; END IF;
  IF v_task.status NOT IN ('open','in_progress') THEN RAISE EXCEPTION 'TASK_NOT_OPEN'; END IF;
  IF v_task.task_type <> 'cost_review' THEN RAISE EXCEPTION 'TASK_TYPE_MISMATCH'; END IF;
  IF v_task.module IS DISTINCT FROM p_module
     OR v_task.reference_table IS DISTINCT FROM p_target_table
     OR v_task.reference_id IS DISTINCT FROM p_target_id THEN
    RAISE EXCEPTION 'TARGET_MISMATCH';
  END IF;

  IF p_target_table='meat_factory_raw_materials' THEN
    SELECT avg_unit_cost, material_code INTO v_old, v_code FROM public.meat_factory_raw_materials
      WHERE material_code=p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    UPDATE public.meat_factory_raw_materials SET avg_unit_cost=p_new_cost, updated_at=now()
      WHERE material_code=p_target_id;
  ELSIF p_target_table='feed_raw_materials' THEN
    SELECT avg_unit_cost, material_code INTO v_old, v_code FROM public.feed_raw_materials
      WHERE material_code=p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    UPDATE public.feed_raw_materials SET avg_unit_cost=p_new_cost, updated_at=now()
      WHERE material_code=p_target_id;
  ELSIF p_target_table='inventory_items' THEN
    SELECT unit_cost INTO v_old FROM public.inventory_items WHERE id=p_target_id::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    UPDATE public.inventory_items SET unit_cost=p_new_cost, updated_at=now() WHERE id=p_target_id::uuid;
  ELSE RAISE EXCEPTION 'INVALID_TARGET'; END IF;

  INSERT INTO public.product_cost_history(module, target_table, target_id, reference_code, old_cost, new_cost, reason, source, approved_by)
  VALUES (p_module, p_target_table, p_target_id, v_code, v_old, p_new_cost, p_reason, 'manager_review', auth.uid());

  UPDATE public.data_quality_tasks SET status='resolved', resolved_by=auth.uid(), resolved_at=now(), resolution_notes=p_reason
    WHERE id=p_task_id;

  INSERT INTO public.manager_review_audit(task_id, action, module, target_table, target_id, old_value, new_value, reason, performed_by)
  VALUES (p_task_id, 'approve_cost', p_module, p_target_table, p_target_id,
          jsonb_build_object('cost', v_old), jsonb_build_object('cost', p_new_cost), p_reason, auth.uid());

  RETURN jsonb_build_object('success', true, 'old', v_old, 'new', p_new_cost);
END $function$;

-- ============================================================
-- mr_dismiss_task — GM / Exec only
-- ============================================================
CREATE OR REPLACE FUNCTION public.mr_dismiss_task(p_task_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_task public.data_quality_tasks%ROWTYPE;
BEGIN
  IF NOT public.mr_can_admin(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_task_id IS NULL THEN RAISE EXCEPTION 'TASK_REQUIRED'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT * INTO v_task FROM public.data_quality_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND'; END IF;
  IF v_task.status NOT IN ('open','in_progress') THEN RAISE EXCEPTION 'TASK_NOT_OPEN'; END IF;

  UPDATE public.data_quality_tasks SET status='dismissed', resolved_by=auth.uid(), resolved_at=now(), resolution_notes=p_reason
    WHERE id=p_task_id;

  INSERT INTO public.manager_review_audit(task_id, action, module, target_table, target_id, reason, performed_by)
  VALUES (p_task_id, 'dismiss', v_task.module, v_task.reference_table, v_task.reference_id, p_reason, auth.uid());

  RETURN jsonb_build_object('success', true);
END $function$;

REVOKE ALL ON FUNCTION public.mr_assign_barcode(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mr_reconcile_negative_stock(uuid, text, text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mr_approve_cost(uuid, text, text, text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mr_dismiss_task(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mr_assign_barcode(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mr_reconcile_negative_stock(uuid, text, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mr_approve_cost(uuid, text, text, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mr_dismiss_task(uuid, text) TO authenticated;

-- ============================================================
-- RLS: data_quality_tasks — scoped read only, no client writes
-- ============================================================
DROP POLICY IF EXISTS "view dq tasks" ON public.data_quality_tasks;
DROP POLICY IF EXISTS "manage dq tasks" ON public.data_quality_tasks;

CREATE POLICY "dq_view_scoped" ON public.data_quality_tasks
  FOR SELECT TO authenticated
  USING (public.mr_can_view_task(auth.uid(), module, task_type));

REVOKE INSERT, UPDATE, DELETE ON public.data_quality_tasks FROM authenticated;
GRANT SELECT ON public.data_quality_tasks TO authenticated;
GRANT ALL ON public.data_quality_tasks TO service_role;

-- ============================================================
-- Audit tables: no forged records
-- ============================================================
DROP POLICY IF EXISTS "mra_insert_system" ON public.manager_review_audit;
CREATE POLICY "mra_insert_admin_only" ON public.manager_review_audit
  FOR INSERT TO authenticated
  WITH CHECK (performed_by = auth.uid() AND public.mr_can_admin(auth.uid()));

DROP POLICY IF EXISTS "pch_insert_authorized" ON public.product_cost_history;
CREATE POLICY "pch_insert_approvers" ON public.product_cost_history
  FOR INSERT TO authenticated
  WITH CHECK (approved_by = auth.uid() AND public.mr_can_approve_cost(auth.uid()));