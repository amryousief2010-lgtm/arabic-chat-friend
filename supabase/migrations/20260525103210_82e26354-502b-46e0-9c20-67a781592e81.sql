-- ============= Manager Review Audit =============
CREATE TABLE IF NOT EXISTS public.manager_review_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.data_quality_tasks(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  module TEXT,
  target_table TEXT,
  target_id TEXT,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  performed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mra_task ON public.manager_review_audit(task_id);
CREATE INDEX IF NOT EXISTS idx_mra_target ON public.manager_review_audit(target_table, target_id);

ALTER TABLE public.manager_review_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mra_view_authorized" ON public.manager_review_audit FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY[
  'general_manager','executive_manager','meat_factory_manager','feed_factory_manager',
  'quality_manager','accountant','financial_manager','warehouse_supervisor'
]::app_role[]));

CREATE POLICY "mra_insert_system" ON public.manager_review_audit FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY[
  'general_manager','executive_manager','meat_factory_manager','feed_factory_manager',
  'quality_manager','accountant','financial_manager','warehouse_supervisor'
]::app_role[]));

-- ============= Product Cost History =============
CREATE TABLE IF NOT EXISTS public.product_cost_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reference_code TEXT,
  old_cost NUMERIC,
  new_cost NUMERIC NOT NULL,
  reason TEXT,
  source TEXT,
  approved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pch_target ON public.product_cost_history(target_table, target_id, created_at DESC);

ALTER TABLE public.product_cost_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pch_view_authorized" ON public.product_cost_history FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY[
  'general_manager','executive_manager','meat_factory_manager','feed_factory_manager',
  'quality_manager','accountant','financial_manager','warehouse_supervisor','cost_accountant'
]::app_role[]));

CREATE POLICY "pch_insert_authorized" ON public.product_cost_history FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY[
  'general_manager','executive_manager','accountant','financial_manager','cost_accountant'
]::app_role[]));

-- ============= Authorization helper for review actions =============
CREATE OR REPLACE FUNCTION public.can_manage_review(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_any_role(_uid, ARRAY[
    'general_manager','executive_manager','meat_factory_manager','feed_factory_manager',
    'quality_manager','accountant','financial_manager','warehouse_supervisor'
  ]::app_role[]);
$$;

-- ============= RPC: Assign barcode to product =============
CREATE OR REPLACE FUNCTION public.mr_assign_barcode(
  p_task_id uuid, p_product_id uuid, p_barcode text, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old text; v_exists boolean;
BEGIN
  IF NOT public.can_manage_review(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_barcode IS NULL OR length(trim(p_barcode)) = 0 THEN
    RAISE EXCEPTION 'BARCODE_REQUIRED';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.products WHERE barcode = p_barcode AND id <> p_product_id) INTO v_exists;
  IF v_exists THEN RAISE EXCEPTION 'BARCODE_DUPLICATE'; END IF;

  SELECT barcode INTO v_old FROM public.products WHERE id = p_product_id FOR UPDATE;
  UPDATE public.products
    SET barcode = trim(p_barcode), is_active = true, updated_at = now()
    WHERE id = p_product_id;

  IF p_task_id IS NOT NULL THEN
    UPDATE public.data_quality_tasks
      SET status='resolved', resolved_by=auth.uid(), resolved_at=now(),
          resolution_notes=COALESCE(p_reason,'تم تعيين باركود')
      WHERE id = p_task_id;
  END IF;

  INSERT INTO public.manager_review_audit(task_id, action, module, target_table, target_id, old_value, new_value, reason, performed_by)
  VALUES (p_task_id, 'assign_barcode', 'meat', 'products', p_product_id::text,
          jsonb_build_object('barcode', v_old, 'is_active', false),
          jsonb_build_object('barcode', p_barcode, 'is_active', true),
          p_reason, auth.uid());

  RETURN jsonb_build_object('success', true);
END $$;

-- ============= RPC: Reconcile negative stock =============
CREATE OR REPLACE FUNCTION public.mr_reconcile_negative_stock(
  p_task_id uuid, p_target_table text, p_target_id text,
  p_new_stock numeric, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old numeric; v_qty numeric; v_item uuid;
BEGIN
  IF NOT public.can_manage_review(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF p_target_table NOT IN ('meat_factory_raw_materials','feed_raw_materials','inventory_items','products') THEN
    RAISE EXCEPTION 'INVALID_TARGET';
  END IF;

  IF p_target_table='meat_factory_raw_materials' THEN
    SELECT stock INTO v_old FROM public.meat_factory_raw_materials WHERE material_code=p_target_id FOR UPDATE;
    UPDATE public.meat_factory_raw_materials SET stock=p_new_stock, updated_at=now() WHERE material_code=p_target_id;
  ELSIF p_target_table='feed_raw_materials' THEN
    SELECT stock INTO v_old FROM public.feed_raw_materials WHERE material_code=p_target_id FOR UPDATE;
    UPDATE public.feed_raw_materials SET stock=p_new_stock, updated_at=now() WHERE material_code=p_target_id;
  ELSIF p_target_table='inventory_items' THEN
    SELECT stock INTO v_old FROM public.inventory_items WHERE id=p_target_id::uuid FOR UPDATE;
    v_qty := p_new_stock - COALESCE(v_old,0);
    UPDATE public.inventory_items SET stock=p_new_stock, updated_at=now() WHERE id=p_target_id::uuid;
    INSERT INTO public.inventory_movements(item_id, warehouse_id, movement_type, quantity, reference, party, performed_by, notes)
    SELECT id, warehouse_id, 'adjustment', p_new_stock, 'تسوية مراجعة مدير', 'Manager Review', auth.uid(), p_reason
      FROM public.inventory_items WHERE id=p_target_id::uuid;
  ELSIF p_target_table='products' THEN
    SELECT stock INTO v_old FROM public.products WHERE id=p_target_id::uuid FOR UPDATE;
    UPDATE public.products SET stock=p_new_stock::int, updated_at=now() WHERE id=p_target_id::uuid;
  END IF;

  IF p_task_id IS NOT NULL THEN
    UPDATE public.data_quality_tasks SET status='resolved', resolved_by=auth.uid(), resolved_at=now(), resolution_notes=p_reason
      WHERE id=p_task_id;
  END IF;

  INSERT INTO public.manager_review_audit(task_id, action, target_table, target_id, old_value, new_value, reason, performed_by)
  VALUES (p_task_id, 'reconcile_stock', p_target_table, p_target_id,
          jsonb_build_object('stock', v_old), jsonb_build_object('stock', p_new_stock), p_reason, auth.uid());

  RETURN jsonb_build_object('success', true, 'old', v_old, 'new', p_new_stock);
END $$;

-- ============= RPC: Approve cost =============
CREATE OR REPLACE FUNCTION public.mr_approve_cost(
  p_task_id uuid, p_module text, p_target_table text, p_target_id text,
  p_new_cost numeric, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old numeric; v_code text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','accountant','financial_manager','cost_accountant'
  ]::app_role[]) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_new_cost IS NULL OR p_new_cost <= 0 THEN RAISE EXCEPTION 'INVALID_COST'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  IF p_target_table='meat_factory_raw_materials' THEN
    SELECT avg_unit_cost, material_code INTO v_old, v_code FROM public.meat_factory_raw_materials
      WHERE material_code=p_target_id FOR UPDATE;
    UPDATE public.meat_factory_raw_materials SET avg_unit_cost=p_new_cost, updated_at=now()
      WHERE material_code=p_target_id;
  ELSIF p_target_table='feed_raw_materials' THEN
    SELECT avg_unit_cost, material_code INTO v_old, v_code FROM public.feed_raw_materials
      WHERE material_code=p_target_id FOR UPDATE;
    UPDATE public.feed_raw_materials SET avg_unit_cost=p_new_cost, updated_at=now()
      WHERE material_code=p_target_id;
  ELSIF p_target_table='inventory_items' THEN
    SELECT unit_cost INTO v_old FROM public.inventory_items WHERE id=p_target_id::uuid FOR UPDATE;
    UPDATE public.inventory_items SET unit_cost=p_new_cost, updated_at=now() WHERE id=p_target_id::uuid;
  ELSE RAISE EXCEPTION 'INVALID_TARGET'; END IF;

  INSERT INTO public.product_cost_history(module, target_table, target_id, reference_code, old_cost, new_cost, reason, source, approved_by)
  VALUES (p_module, p_target_table, p_target_id, v_code, v_old, p_new_cost, p_reason, 'manager_review', auth.uid());

  IF p_task_id IS NOT NULL THEN
    UPDATE public.data_quality_tasks SET status='resolved', resolved_by=auth.uid(), resolved_at=now(), resolution_notes=p_reason
      WHERE id=p_task_id;
  END IF;

  INSERT INTO public.manager_review_audit(task_id, action, module, target_table, target_id, old_value, new_value, reason, performed_by)
  VALUES (p_task_id, 'approve_cost', p_module, p_target_table, p_target_id,
          jsonb_build_object('cost', v_old), jsonb_build_object('cost', p_new_cost), p_reason, auth.uid());

  RETURN jsonb_build_object('success', true, 'old', v_old, 'new', p_new_cost);
END $$;

-- ============= RPC: Dismiss task =============
CREATE OR REPLACE FUNCTION public.mr_dismiss_task(p_task_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_task public.data_quality_tasks%ROWTYPE;
BEGIN
  IF NOT public.can_manage_review(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT * INTO v_task FROM public.data_quality_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND'; END IF;

  UPDATE public.data_quality_tasks SET status='dismissed', resolved_by=auth.uid(), resolved_at=now(), resolution_notes=p_reason
    WHERE id=p_task_id;

  INSERT INTO public.manager_review_audit(task_id, action, module, target_table, target_id, reason, performed_by)
  VALUES (p_task_id, 'dismiss', v_task.module, v_task.reference_table, v_task.reference_id, p_reason, auth.uid());

  RETURN jsonb_build_object('success', true);
END $$;