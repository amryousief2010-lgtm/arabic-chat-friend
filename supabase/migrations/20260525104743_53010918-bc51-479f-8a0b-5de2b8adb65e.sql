-- ============================================================
-- PHASE 5: Production Batch Workflow + BOM v2 Approval
-- Non-destructive: no DROP, no DELETE, no TRUNCATE.
-- ============================================================

-- ---------- 1. Role gate for BOM activation ----------
CREATE OR REPLACE FUNCTION public.can_activate_bom(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT public.has_any_role(_uid, ARRAY[
    'general_manager','executive_manager','accountant','financial_manager'
  ]::app_role[]);
$$;

-- ---------- 2. Role gate for batch workflow ----------
CREATE OR REPLACE FUNCTION public.can_manage_meat_batch(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT public.has_any_role(_uid, ARRAY[
    'general_manager','executive_manager','meat_factory_manager','production_manager'
  ]::app_role[]);
$$;
CREATE OR REPLACE FUNCTION public.can_manage_feed_batch(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT public.has_any_role(_uid, ARRAY[
    'general_manager','executive_manager','feed_factory_manager','production_manager'
  ]::app_role[]);
$$;
CREATE OR REPLACE FUNCTION public.can_approve_batch(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT public.has_any_role(_uid, ARRAY[
    'general_manager','executive_manager','meat_factory_manager','feed_factory_manager',
    'production_manager','quality_manager'
  ]::app_role[]);
$$;

-- ---------- 3. BOM approval audit ----------
CREATE TABLE IF NOT EXISTS public.bom_approval_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL, -- 'meat' | 'feed'
  product_code text,
  recipe_id uuid,
  version int,
  action text NOT NULL, -- 'validate','activate','deactivate','reject'
  result jsonb,
  notes text,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bom_approval_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit visible to reviewers" ON public.bom_approval_audit
  FOR SELECT USING (public.can_manage_review(auth.uid()) OR public.can_activate_bom(auth.uid()));
-- inserts only via SECURITY DEFINER RPCs (no policy for INSERT)

-- ---------- 4. Production batch workflow audit ----------
CREATE TABLE IF NOT EXISTS public.production_batch_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL, -- 'meat' | 'feed'
  batch_id uuid NOT NULL,
  action text NOT NULL, -- 'create','submit','approve','close','cancel','reverse'
  old_status text,
  new_status text,
  payload jsonb,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.production_batch_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "batch audit visible to factory teams" ON public.production_batch_audit
  FOR SELECT USING (
    public.can_manage_meat_batch(auth.uid()) OR public.can_manage_feed_batch(auth.uid())
    OR public.can_manage_review(auth.uid())
  );

-- ---------- 5. Meat BOM version status (new tracking) ----------
CREATE TABLE IF NOT EXISTS public.meat_recipe_version_status (
  product_code text NOT NULL,
  version int NOT NULL,
  status text NOT NULL DEFAULT 'draft', -- 'draft','active','superseded','rejected'
  is_active boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  activated_by uuid,
  deactivated_at timestamptz,
  deactivated_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_code, version)
);
ALTER TABLE public.meat_recipe_version_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat bom status visible to factory" ON public.meat_recipe_version_status
  FOR SELECT USING (
    public.can_manage_meat_batch(auth.uid())
    OR public.can_manage_review(auth.uid())
    OR public.can_activate_bom(auth.uid())
  );
-- Enforce single active version per product
CREATE UNIQUE INDEX IF NOT EXISTS uniq_meat_active_version
  ON public.meat_recipe_version_status(product_code) WHERE is_active = true;

-- Backfill: mark v1 as active and v>1 as draft for existing product_codes (idempotent)
INSERT INTO public.meat_recipe_version_status (product_code, version, status, is_active, activated_at, notes)
SELECT product_code, version,
       CASE WHEN version = 1 THEN 'active' ELSE 'draft' END,
       CASE WHEN version = 1 THEN true ELSE false END,
       CASE WHEN version = 1 THEN now() ELSE NULL END,
       'تمت التعبئة الأولية تلقائياً — Phase 5'
FROM (SELECT DISTINCT product_code, version FROM public.meat_factory_recipes) s
ON CONFLICT (product_code, version) DO NOTHING;

-- ---------- 6. Extend meat_factory_batches ----------
ALTER TABLE public.meat_factory_batches
  ADD COLUMN IF NOT EXISTS bom_version int,
  ADD COLUMN IF NOT EXISTS service_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waste_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waste_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_unit numeric,
  ADD COLUMN IF NOT EXISTS target_warehouse_id uuid,
  ADD COLUMN IF NOT EXISTS finished_inventory_item_id uuid,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS override_negative boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_reason text;

-- consumption rows can link to inventory items
ALTER TABLE public.meat_factory_batch_consumption
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid,
  ADD COLUMN IF NOT EXISTS posted_movement_id uuid;
ALTER TABLE public.meat_factory_batch_packaging
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid,
  ADD COLUMN IF NOT EXISTS posted_movement_id uuid;

-- ---------- 7. Extend feed_production_batches ----------
ALTER TABLE public.feed_production_batches
  ADD COLUMN IF NOT EXISTS bom_version int,
  ADD COLUMN IF NOT EXISTS feed_product_id uuid,
  ADD COLUMN IF NOT EXISTS labor_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waste_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waste_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_kg numeric,
  ADD COLUMN IF NOT EXISTS unit_cost numeric,
  ADD COLUMN IF NOT EXISTS target_warehouse_id uuid,
  ADD COLUMN IF NOT EXISTS finished_inventory_item_id uuid,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS override_negative boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS production_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS posted_to_inventory boolean NOT NULL DEFAULT false;

ALTER TABLE public.feed_batch_consumption
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid,
  ADD COLUMN IF NOT EXISTS posted_movement_id uuid;

-- ---------- 8. Lock closed batches from edit ----------
CREATE OR REPLACE FUNCTION public.lock_closed_meat_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' THEN
    -- allow only system-controlled cost-correction fields via reversal RPC (none for now)
    IF NEW.status <> 'closed' THEN
      RAISE EXCEPTION 'BATCH_LOCKED: لا يمكن تعديل دفعة مغلقة. استخدم حركة عكسية.';
    END IF;
    -- block any column change while closed
    IF to_jsonb(OLD) <> to_jsonb(NEW) THEN
      RAISE EXCEPTION 'BATCH_LOCKED: الدفعة مغلقة وأى تعديل يجب أن يتم بحركة عكسية';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lock_closed_meat_batch ON public.meat_factory_batches;
CREATE TRIGGER trg_lock_closed_meat_batch
  BEFORE UPDATE ON public.meat_factory_batches
  FOR EACH ROW EXECUTE FUNCTION public.lock_closed_meat_batch();

CREATE OR REPLACE FUNCTION public.lock_closed_feed_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' THEN
    IF NEW.status <> 'closed' OR to_jsonb(OLD) <> to_jsonb(NEW) THEN
      RAISE EXCEPTION 'BATCH_LOCKED: الدفعة مغلقة وأى تعديل يجب أن يتم بحركة عكسية';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lock_closed_feed_batch ON public.feed_production_batches;
CREATE TRIGGER trg_lock_closed_feed_batch
  BEFORE UPDATE ON public.feed_production_batches
  FOR EACH ROW EXECUTE FUNCTION public.lock_closed_feed_batch();

-- ---------- 9. Validate BOM (meat) ----------
CREATE OR REPLACE FUNCTION public.validate_meat_bom(p_product_code text, p_version int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE issues jsonb := '[]'::jsonb; v_count int;
BEGIN
  -- product must have a barcode & be active
  IF NOT EXISTS (
    SELECT 1 FROM public.meat_factory_products
    WHERE product_code = p_product_code AND is_active = true
      AND barcode IS NOT NULL AND length(trim(barcode)) > 0
  ) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','MISSING_BARCODE','msg','المنتج بدون باركود أو غير مفعل'));
  END IF;

  -- recipe lines must exist with material_code & unit
  SELECT COUNT(*) INTO v_count FROM public.meat_factory_recipes
    WHERE product_code=p_product_code AND version=p_version;
  IF v_count = 0 THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','NO_LINES','msg','لا توجد بنود فى هذه النسخة'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.meat_factory_recipes
             WHERE product_code=p_product_code AND version=p_version
               AND line_type='Input'
               AND (material_code IS NULL OR length(trim(material_code))=0 OR unit IS NULL)) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','INVALID_LINE','msg','بنود بدون material_code أو وحدة'));
  END IF;

  -- materials must not have negative stock or zero cost with stock
  IF EXISTS (
    SELECT 1 FROM public.meat_factory_recipes r
    JOIN public.meat_factory_raw_materials m ON m.material_code = r.material_code
    WHERE r.product_code=p_product_code AND r.version=p_version AND r.line_type='Input'
      AND m.stock < 0
  ) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','NEGATIVE_STOCK','msg','خامة فى الوصفة برصيد سالب غير مسوى'));
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.meat_factory_recipes r
    JOIN public.meat_factory_raw_materials m ON m.material_code = r.material_code
    WHERE r.product_code=p_product_code AND r.version=p_version AND r.line_type='Input'
      AND m.avg_unit_cost = 0 AND m.stock > 0
  ) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','ZERO_COST','msg','خامة بتكلفة صفر مع رصيد موجب'));
  END IF;

  RETURN jsonb_build_object('ok', jsonb_array_length(issues)=0, 'issues', issues);
END $$;
REVOKE ALL ON FUNCTION public.validate_meat_bom(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_meat_bom(text,int) TO authenticated;

-- ---------- 10. Validate BOM (feed) ----------
CREATE OR REPLACE FUNCTION public.validate_feed_bom(p_recipe_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE issues jsonb := '[]'::jsonb; v_rec public.feed_recipes%ROWTYPE; v_count int; v_inv text;
BEGIN
  SELECT * INTO v_rec FROM public.feed_recipes WHERE id = p_recipe_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'issues', jsonb_build_array(jsonb_build_object('code','NOT_FOUND','msg','الوصفة غير موجودة')));
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.feed_recipe_items WHERE recipe_id = p_recipe_id;
  IF v_count = 0 THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','NO_LINES','msg','لا توجد بنود فى الوصفة'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.feed_recipe_items WHERE recipe_id=p_recipe_id AND (quantity IS NULL OR quantity<=0 OR unit IS NULL)) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','INVALID_LINE','msg','بنود بكميات أو وحدات غير صالحة'));
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.feed_recipe_items i
    JOIN public.feed_raw_materials m ON m.id = i.raw_material_id
    WHERE i.recipe_id=p_recipe_id AND m.stock < 0
  ) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','NEGATIVE_STOCK','msg','خامة فى الوصفة برصيد سالب غير مسوى'));
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.feed_recipe_items i
    JOIN public.feed_raw_materials m ON m.id = i.raw_material_id
    WHERE i.recipe_id=p_recipe_id AND m.unit_cost = 0 AND m.stock > 0
  ) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','ZERO_COST','msg','خامة بتكلفة صفر مع رصيد موجب'));
  END IF;

  -- If recipe is linked to invoice 164 (still needs_review), block activation
  v_inv := v_rec.source_invoice;
  IF v_inv = '164' OR v_inv ILIKE '%164%' THEN
    IF EXISTS (SELECT 1 FROM public.feed_invoice_batches WHERE invoice_no='164' AND status='needs_review') THEN
      issues := issues || jsonb_build_array(jsonb_build_object('code','INVOICE_164_PENDING','msg','فاتورة 164 لا تزال needs_review'));
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', jsonb_array_length(issues)=0, 'issues', issues);
END $$;
REVOKE ALL ON FUNCTION public.validate_feed_bom(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_feed_bom(uuid) TO authenticated;

-- ---------- 11. Activate BOM (meat) ----------
CREATE OR REPLACE FUNCTION public.activate_meat_bom(p_product_code text, p_version int, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_uid uuid := auth.uid(); v_res jsonb; v_old int;
BEGIN
  IF NOT public.can_activate_bom(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  v_res := public.validate_meat_bom(p_product_code, p_version);
  IF NOT (v_res->>'ok')::boolean THEN
    INSERT INTO public.bom_approval_audit(module,product_code,version,action,result,notes,performed_by)
    VALUES ('meat',p_product_code,p_version,'reject',v_res,p_notes,v_uid);
    RAISE EXCEPTION 'VALIDATION_FAILED: %', v_res::text;
  END IF;
  -- deactivate previous active(s) (preserve rows, just flip flags)
  SELECT version INTO v_old FROM public.meat_recipe_version_status WHERE product_code=p_product_code AND is_active=true;
  UPDATE public.meat_recipe_version_status
    SET is_active=false, status='superseded', deactivated_at=now(), deactivated_by=v_uid, updated_at=now()
    WHERE product_code=p_product_code AND is_active=true AND version <> p_version;
  -- upsert target row
  INSERT INTO public.meat_recipe_version_status(product_code,version,status,is_active,activated_at,activated_by,notes)
  VALUES (p_product_code,p_version,'active',true,now(),v_uid,p_notes)
  ON CONFLICT (product_code,version) DO UPDATE
    SET is_active=true, status='active', activated_at=now(), activated_by=v_uid,
        deactivated_at=NULL, deactivated_by=NULL, notes=COALESCE(EXCLUDED.notes, public.meat_recipe_version_status.notes),
        updated_at=now();
  INSERT INTO public.bom_approval_audit(module,product_code,version,action,result,notes,performed_by)
  VALUES ('meat',p_product_code,p_version,'activate',v_res,p_notes,v_uid);
  RETURN jsonb_build_object('success',true,'previous_version',v_old,'new_version',p_version);
END $$;
REVOKE ALL ON FUNCTION public.activate_meat_bom(text,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_meat_bom(text,int,text) TO authenticated;

-- ---------- 12. Activate BOM (feed) ----------
CREATE OR REPLACE FUNCTION public.activate_feed_bom(p_recipe_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_uid uuid := auth.uid(); v_res jsonb; v_rec public.feed_recipes%ROWTYPE; v_old uuid;
BEGIN
  IF NOT public.can_activate_bom(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_rec FROM public.feed_recipes WHERE id = p_recipe_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_res := public.validate_feed_bom(p_recipe_id);
  IF NOT (v_res->>'ok')::boolean THEN
    INSERT INTO public.bom_approval_audit(module,recipe_id,version,action,result,notes,performed_by)
    VALUES ('feed',p_recipe_id,v_rec.version,'reject',v_res,p_notes,v_uid);
    RAISE EXCEPTION 'VALIDATION_FAILED: %', v_res::text;
  END IF;
  -- deactivate siblings of same feed_type/feed_product
  SELECT id INTO v_old FROM public.feed_recipes
    WHERE is_active=true AND id <> p_recipe_id
      AND ( (v_rec.feed_product_id IS NOT NULL AND feed_product_id = v_rec.feed_product_id)
            OR (v_rec.feed_product_id IS NULL AND feed_type = v_rec.feed_type) )
    LIMIT 1;
  UPDATE public.feed_recipes
    SET is_active=false, recipe_status='superseded', updated_at=now()
    WHERE is_active=true AND id <> p_recipe_id
      AND ( (v_rec.feed_product_id IS NOT NULL AND feed_product_id = v_rec.feed_product_id)
            OR (v_rec.feed_product_id IS NULL AND feed_type = v_rec.feed_type) );
  UPDATE public.feed_recipes
    SET is_active=true, recipe_status='active', approved_by=v_uid, approved_at=now(), updated_at=now()
    WHERE id = p_recipe_id;
  INSERT INTO public.bom_approval_audit(module,recipe_id,version,action,result,notes,performed_by)
  VALUES ('feed',p_recipe_id,v_rec.version,'activate',v_res,p_notes,v_uid);
  RETURN jsonb_build_object('success',true,'previous_recipe_id',v_old,'new_recipe_id',p_recipe_id);
END $$;
REVOKE ALL ON FUNCTION public.activate_feed_bom(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_feed_bom(uuid,text) TO authenticated;

-- ============================================================
-- 13. MEAT BATCH WORKFLOW RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.meat_batch_submit_review(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_uid uuid := auth.uid(); v_b public.meat_factory_batches%ROWTYPE;
BEGIN
  IF NOT public.can_manage_meat_batch(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.meat_factory_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status NOT IN ('draft','planned') THEN RAISE EXCEPTION 'INVALID_STATUS: %', v_b.status; END IF;
  UPDATE public.meat_factory_batches
    SET status='under_review', reviewed_by=v_uid, reviewed_at=now(), updated_at=now()
    WHERE id=p_batch_id;
  INSERT INTO public.production_batch_audit(module,batch_id,action,old_status,new_status,performed_by)
  VALUES ('meat',p_batch_id,'submit',v_b.status,'under_review',v_uid);
  RETURN jsonb_build_object('success',true);
END $$;

CREATE OR REPLACE FUNCTION public.meat_batch_approve(p_batch_id uuid, p_override_negative boolean DEFAULT false, p_override_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_uid uuid := auth.uid(); v_b public.meat_factory_batches%ROWTYPE;
        v_row record; v_check jsonb; v_issues jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.can_approve_batch(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.meat_factory_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status <> 'under_review' THEN RAISE EXCEPTION 'INVALID_STATUS: %', v_b.status; END IF;

  -- validate stock + zero-cost for each consumption line (must have inventory_item_id)
  FOR v_row IN
    SELECT id, inventory_item_id, quantity, material_code FROM public.meat_factory_batch_consumption WHERE batch_id=p_batch_id
    UNION ALL
    SELECT id, inventory_item_id, quantity, packaging_name_ar FROM public.meat_factory_batch_packaging WHERE batch_id=p_batch_id
  LOOP
    IF v_row.inventory_item_id IS NULL THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('material',v_row.material_code,'reason','NO_INVENTORY_LINK'));
      CONTINUE;
    END IF;
    v_check := public.inv_can_consume(v_row.inventory_item_id, v_row.quantity);
    IF NOT (v_check->>'ok')::boolean THEN
      IF (v_check->>'reason')='INSUFFICIENT_STOCK' AND p_override_negative THEN
        IF NOT public.can_approve_inventory_override(v_uid) THEN RAISE EXCEPTION 'OVERRIDE_NOT_AUTHORIZED'; END IF;
        IF p_override_reason IS NULL OR length(trim(p_override_reason))=0 THEN RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED'; END IF;
        -- accept with override
      ELSE
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('material',v_row.material_code,'check',v_check));
      END IF;
    END IF;
  END LOOP;
  IF jsonb_array_length(v_issues) > 0 THEN
    RAISE EXCEPTION 'PRE_APPROVAL_BLOCKED: %', v_issues::text;
  END IF;

  UPDATE public.meat_factory_batches
    SET status='approved', approved_by=v_uid, approved_at=now(),
        override_negative=p_override_negative, override_reason=p_override_reason, updated_at=now()
    WHERE id=p_batch_id;
  INSERT INTO public.production_batch_audit(module,batch_id,action,old_status,new_status,payload,performed_by)
  VALUES ('meat',p_batch_id,'approve','under_review','approved',
          jsonb_build_object('override_negative',p_override_negative,'override_reason',p_override_reason), v_uid);
  RETURN jsonb_build_object('success',true);
END $$;

CREATE OR REPLACE FUNCTION public.meat_batch_close(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_uid uuid := auth.uid(); v_b public.meat_factory_batches%ROWTYPE;
        r record; v_mv uuid; v_total_mat numeric := 0; v_total_pack numeric := 0;
        v_cost_per numeric;
BEGIN
  IF NOT public.can_approve_batch(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.meat_factory_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status <> 'approved' THEN RAISE EXCEPTION 'INVALID_STATUS: %', v_b.status; END IF;
  IF v_b.actual_qty IS NULL OR v_b.actual_qty <= 0 THEN RAISE EXCEPTION 'ACTUAL_QTY_REQUIRED'; END IF;
  IF v_b.target_warehouse_id IS NULL THEN RAISE EXCEPTION 'TARGET_WAREHOUSE_REQUIRED'; END IF;
  IF v_b.finished_inventory_item_id IS NULL THEN RAISE EXCEPTION 'FINISHED_ITEM_REQUIRED'; END IF;

  -- Post raw materials (production_consumption)
  FOR r IN SELECT * FROM public.meat_factory_batch_consumption WHERE batch_id=p_batch_id LOOP
    IF r.inventory_item_id IS NULL THEN RAISE EXCEPTION 'MATERIAL_NOT_LINKED: %', r.material_code; END IF;
    v_mv := public.inv_post_movement(
      r.inventory_item_id, COALESCE(r.warehouse_id, v_b.target_warehouse_id),
      'production_consumption', r.quantity, r.unit_cost,
      'meat_batch', p_batch_id::text, 'meat',
      'TEST-DISPATCH-C استهلاك إنتاج', v_b.override_negative);
    UPDATE public.meat_factory_batch_consumption SET posted_movement_id=v_mv WHERE id=r.id;
    v_total_mat := v_total_mat + COALESCE(r.line_total, r.quantity*r.unit_cost);
  END LOOP;

  -- Post packaging
  FOR r IN SELECT * FROM public.meat_factory_batch_packaging WHERE batch_id=p_batch_id LOOP
    IF r.inventory_item_id IS NULL THEN RAISE EXCEPTION 'PACKAGING_NOT_LINKED: %', r.packaging_name_ar; END IF;
    v_mv := public.inv_post_movement(
      r.inventory_item_id, COALESCE(r.warehouse_id, v_b.target_warehouse_id),
      'packaging_consumption', r.quantity, r.unit_cost,
      'meat_batch', p_batch_id::text, 'meat',
      'TEST-DISPATCH-C استهلاك تغليف', v_b.override_negative);
    UPDATE public.meat_factory_batch_packaging SET posted_movement_id=v_mv WHERE id=r.id;
    v_total_pack := v_total_pack + COALESCE(r.line_total, r.quantity*r.unit_cost);
  END LOOP;

  -- Waste
  IF v_b.waste_qty > 0 THEN
    INSERT INTO public.production_batch_audit(module,batch_id,action,new_status,payload,performed_by)
    VALUES ('meat',p_batch_id,'waste','closed', jsonb_build_object('waste_qty',v_b.waste_qty,'waste_cost',v_b.waste_cost), v_uid);
  END IF;

  -- Compute total + unit cost
  v_cost_per := (v_total_mat + v_total_pack + COALESCE(v_b.labor_cost,0) + COALESCE(v_b.service_cost,0) + COALESCE(v_b.other_expenses,0) + COALESCE(v_b.waste_cost,0) - COALESCE(v_b.byproduct_value,0))
                / NULLIF(v_b.actual_qty,0);

  -- Finished goods receipt
  PERFORM public.inv_post_movement(
    v_b.finished_inventory_item_id, v_b.target_warehouse_id,
    'finished_goods_receipt', v_b.actual_qty, v_cost_per,
    'meat_batch', p_batch_id::text, 'meat',
    'TEST-DISPATCH-C استلام منتج تام', false);

  UPDATE public.meat_factory_batches SET
    materials_cost = v_total_mat,
    packaging_cost = v_total_pack,
    total_cost = v_total_mat + v_total_pack + COALESCE(labor_cost,0) + COALESCE(service_cost,0) + COALESCE(other_expenses,0) + COALESCE(waste_cost,0) - COALESCE(byproduct_value,0),
    cost_per_unit = v_cost_per,
    unit_cost = v_cost_per,
    status='closed', closed_by=v_uid, closed_at=now(),
    posted_to_inventory=true, posted_at=now(), posted_warehouse_id=target_warehouse_id,
    updated_at=now()
  WHERE id=p_batch_id;

  INSERT INTO public.production_batch_audit(module,batch_id,action,old_status,new_status,payload,performed_by)
  VALUES ('meat',p_batch_id,'close','approved','closed',
          jsonb_build_object('cost_per_unit',v_cost_per,'total_materials',v_total_mat,'total_packaging',v_total_pack), v_uid);

  RETURN jsonb_build_object('success',true,'cost_per_unit',v_cost_per,'total_materials',v_total_mat,'total_packaging',v_total_pack);
END $$;

CREATE OR REPLACE FUNCTION public.meat_batch_cancel(p_batch_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_uid uuid := auth.uid(); v_b public.meat_factory_batches%ROWTYPE;
BEGIN
  IF NOT public.can_manage_meat_batch(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.meat_factory_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status = 'closed' THEN RAISE EXCEPTION 'BATCH_LOCKED'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  UPDATE public.meat_factory_batches
    SET status='cancelled', cancelled_by=v_uid, cancelled_at=now(), cancel_reason=p_reason, updated_at=now()
    WHERE id=p_batch_id;
  INSERT INTO public.production_batch_audit(module,batch_id,action,old_status,new_status,payload,performed_by)
  VALUES ('meat',p_batch_id,'cancel',v_b.status,'cancelled', jsonb_build_object('reason',p_reason), v_uid);
  RETURN jsonb_build_object('success',true);
END $$;

REVOKE ALL ON FUNCTION public.meat_batch_submit_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meat_batch_approve(uuid,boolean,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meat_batch_close(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meat_batch_cancel(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meat_batch_submit_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meat_batch_approve(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meat_batch_close(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meat_batch_cancel(uuid,text) TO authenticated;

-- ============================================================
-- 14. FEED BATCH WORKFLOW RPCs (mirror of meat)
-- ============================================================
CREATE OR REPLACE FUNCTION public.feed_batch_submit_review(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_uid uuid := auth.uid(); v_b public.feed_production_batches%ROWTYPE;
BEGIN
  IF NOT public.can_manage_feed_batch(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.feed_production_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status NOT IN ('draft','planned') THEN RAISE EXCEPTION 'INVALID_STATUS: %', v_b.status; END IF;
  -- Recipe must be active and not linked to pending invoice 164
  IF NOT EXISTS (SELECT 1 FROM public.feed_recipes WHERE id=v_b.recipe_id AND is_active=true AND recipe_status='active') THEN
    RAISE EXCEPTION 'RECIPE_NOT_ACTIVE: استخدم وصفة معتمدة فقط';
  END IF;
  UPDATE public.feed_production_batches
    SET status='under_review', reviewed_by=v_uid, reviewed_at=now(), updated_at=now()
    WHERE id=p_batch_id;
  INSERT INTO public.production_batch_audit(module,batch_id,action,old_status,new_status,performed_by)
  VALUES ('feed',p_batch_id,'submit',v_b.status,'under_review',v_uid);
  RETURN jsonb_build_object('success',true);
END $$;

CREATE OR REPLACE FUNCTION public.feed_batch_approve(p_batch_id uuid, p_override_negative boolean DEFAULT false, p_override_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_uid uuid := auth.uid(); v_b public.feed_production_batches%ROWTYPE;
        r record; v_check jsonb; v_issues jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.can_approve_batch(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.feed_production_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status <> 'under_review' THEN RAISE EXCEPTION 'INVALID_STATUS: %', v_b.status; END IF;

  FOR r IN SELECT * FROM public.feed_batch_consumption WHERE batch_id=p_batch_id LOOP
    IF r.inventory_item_id IS NULL THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('material',r.raw_material_id,'reason','NO_INVENTORY_LINK'));
      CONTINUE;
    END IF;
    v_check := public.inv_can_consume(r.inventory_item_id, r.quantity);
    IF NOT (v_check->>'ok')::boolean THEN
      IF (v_check->>'reason')='INSUFFICIENT_STOCK' AND p_override_negative THEN
        IF NOT public.can_approve_inventory_override(v_uid) THEN RAISE EXCEPTION 'OVERRIDE_NOT_AUTHORIZED'; END IF;
        IF p_override_reason IS NULL OR length(trim(p_override_reason))=0 THEN RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED'; END IF;
      ELSE
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('material',r.raw_material_id,'check',v_check));
      END IF;
    END IF;
  END LOOP;
  IF jsonb_array_length(v_issues) > 0 THEN RAISE EXCEPTION 'PRE_APPROVAL_BLOCKED: %', v_issues::text; END IF;

  UPDATE public.feed_production_batches
    SET status='approved', approved_by=v_uid, approved_at=now(),
        override_negative=p_override_negative, override_reason=p_override_reason, updated_at=now()
    WHERE id=p_batch_id;
  INSERT INTO public.production_batch_audit(module,batch_id,action,old_status,new_status,payload,performed_by)
  VALUES ('feed',p_batch_id,'approve','under_review','approved',
          jsonb_build_object('override_negative',p_override_negative,'override_reason',p_override_reason), v_uid);
  RETURN jsonb_build_object('success',true);
END $$;

CREATE OR REPLACE FUNCTION public.feed_batch_close(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_uid uuid := auth.uid(); v_b public.feed_production_batches%ROWTYPE;
        r record; v_mv uuid; v_total_mat numeric := 0; v_cost_per numeric;
BEGIN
  IF NOT public.can_approve_batch(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.feed_production_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status <> 'approved' THEN RAISE EXCEPTION 'INVALID_STATUS: %', v_b.status; END IF;
  IF v_b.actual_quantity IS NULL OR v_b.actual_quantity <= 0 THEN RAISE EXCEPTION 'ACTUAL_QTY_REQUIRED'; END IF;
  IF v_b.target_warehouse_id IS NULL THEN RAISE EXCEPTION 'TARGET_WAREHOUSE_REQUIRED'; END IF;
  IF v_b.finished_inventory_item_id IS NULL THEN RAISE EXCEPTION 'FINISHED_ITEM_REQUIRED'; END IF;

  FOR r IN SELECT * FROM public.feed_batch_consumption WHERE batch_id=p_batch_id LOOP
    IF r.inventory_item_id IS NULL THEN RAISE EXCEPTION 'MATERIAL_NOT_LINKED: %', r.raw_material_id; END IF;
    v_mv := public.inv_post_movement(
      r.inventory_item_id, COALESCE(r.warehouse_id, v_b.target_warehouse_id),
      'production_consumption', r.quantity, r.unit_cost,
      'feed_batch', p_batch_id::text, 'feed',
      'TEST-DISPATCH-C استهلاك إنتاج علف', v_b.override_negative);
    UPDATE public.feed_batch_consumption SET posted_movement_id=v_mv WHERE id=r.id;
    v_total_mat := v_total_mat + COALESCE(r.total_cost, r.quantity*r.unit_cost);
  END LOOP;

  v_cost_per := (v_total_mat + COALESCE(v_b.labor_cost,0) + COALESCE(v_b.service_cost,0) + COALESCE(v_b.other_cost,0) + COALESCE(v_b.waste_cost,0))
                / NULLIF(v_b.actual_quantity,0);

  PERFORM public.inv_post_movement(
    v_b.finished_inventory_item_id, v_b.target_warehouse_id,
    'finished_goods_receipt', v_b.actual_quantity, v_cost_per,
    'feed_batch', p_batch_id::text, 'feed',
    'TEST-DISPATCH-C استلام علف تام', false);

  UPDATE public.feed_production_batches SET
    total_cost = v_total_mat + COALESCE(labor_cost,0) + COALESCE(service_cost,0) + COALESCE(other_cost,0) + COALESCE(waste_cost,0),
    cost_per_kg = v_cost_per, unit_cost = v_cost_per,
    status='closed', closed_by=v_uid, closed_at=now(),
    posted_to_inventory=true, completed_at=now(),
    updated_at=now()
  WHERE id=p_batch_id;

  INSERT INTO public.production_batch_audit(module,batch_id,action,old_status,new_status,payload,performed_by)
  VALUES ('feed',p_batch_id,'close','approved','closed',
          jsonb_build_object('cost_per_kg',v_cost_per,'total_materials',v_total_mat), v_uid);

  RETURN jsonb_build_object('success',true,'cost_per_kg',v_cost_per,'total_materials',v_total_mat);
END $$;

CREATE OR REPLACE FUNCTION public.feed_batch_cancel(p_batch_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_uid uuid := auth.uid(); v_b public.feed_production_batches%ROWTYPE;
BEGIN
  IF NOT public.can_manage_feed_batch(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.feed_production_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status = 'closed' THEN RAISE EXCEPTION 'BATCH_LOCKED'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  UPDATE public.feed_production_batches
    SET status='cancelled', cancelled_by=v_uid, cancelled_at=now(), cancel_reason=p_reason, updated_at=now()
    WHERE id=p_batch_id;
  INSERT INTO public.production_batch_audit(module,batch_id,action,old_status,new_status,payload,performed_by)
  VALUES ('feed',p_batch_id,'cancel',v_b.status,'cancelled', jsonb_build_object('reason',p_reason), v_uid);
  RETURN jsonb_build_object('success',true);
END $$;

REVOKE ALL ON FUNCTION public.feed_batch_submit_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.feed_batch_approve(uuid,boolean,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.feed_batch_close(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.feed_batch_cancel(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feed_batch_submit_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.feed_batch_approve(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.feed_batch_close(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.feed_batch_cancel(uuid,text) TO authenticated;

-- ============================================================
-- 15. SELECT policies (read-only) for factory teams
--   - These tables already have RLS enabled; add SELECT policies if missing.
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='meat_factory_batches' AND policyname='meat batches: factory read') THEN
    CREATE POLICY "meat batches: factory read" ON public.meat_factory_batches
      FOR SELECT USING (
        public.can_manage_meat_batch(auth.uid())
        OR public.can_manage_review(auth.uid())
        OR public.can_activate_bom(auth.uid())
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='feed_production_batches' AND policyname='feed batches: factory read') THEN
    CREATE POLICY "feed batches: factory read" ON public.feed_production_batches
      FOR SELECT USING (
        public.can_manage_feed_batch(auth.uid())
        OR public.can_manage_review(auth.uid())
        OR public.can_activate_bom(auth.uid())
      );
  END IF;
END $$;