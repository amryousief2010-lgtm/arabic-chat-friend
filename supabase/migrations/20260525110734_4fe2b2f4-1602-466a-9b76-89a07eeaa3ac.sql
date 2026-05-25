
ALTER TABLE public.meat_factory_batches DROP CONSTRAINT IF EXISTS meat_factory_batches_status_check;
ALTER TABLE public.meat_factory_batches ADD CONSTRAINT meat_factory_batches_status_check
  CHECK (status = ANY (ARRAY['planned','draft','under_review','in_progress','approved','completed','closed','cancelled']::text[]));

ALTER TABLE public.feed_production_batches DROP CONSTRAINT IF EXISTS feed_production_batches_status_check;
ALTER TABLE public.feed_production_batches ADD CONSTRAINT feed_production_batches_status_check
  CHECK (status = ANY (ARRAY['planned','draft','under_review','in_progress','approved','completed','closed','cancelled']::text[]));

ALTER TABLE public.meat_factory_raw_materials ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.feed_raw_materials       ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.packaging_materials      ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.meat_factory_products    ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.feed_products            ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_identity
  ON public.inventory_items (warehouse_id, module, category, item_code)
  WHERE item_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.phase6_test_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL, kind text NOT NULL, batch_id uuid,
  result jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.phase6_test_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p6_log_select ON public.phase6_test_log;
CREATE POLICY p6_log_select ON public.phase6_test_log
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','financial_manager','meat_factory_manager','feed_factory_manager']::app_role[]));

CREATE OR REPLACE FUNCTION public.fd_can_manage(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_uid, ARRAY['general_manager','executive_manager','financial_manager','meat_factory_manager','feed_factory_manager','warehouse_supervisor']::app_role[])
$$;

CREATE OR REPLACE FUNCTION public.fd_link_factory_items()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wh uuid; v_uid uuid := auth.uid();
  v_meat int := 0; v_feed int := 0; v_pack int := 0; v_meatp int := 0; v_feedp int := 0;
  v_unresolved jsonb := '[]'::jsonb; r record; v_item_id uuid;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.fd_can_manage(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT id INTO v_wh FROM public.warehouses WHERE is_active ORDER BY created_at ASC LIMIT 1;
  IF v_wh IS NULL THEN RAISE EXCEPTION 'NO_DEFAULT_WAREHOUSE'; END IF;

  FOR r IN SELECT * FROM public.meat_factory_raw_materials WHERE inventory_item_id IS NULL LOOP
    IF r.material_code IS NULL OR r.material_code='' THEN
      v_unresolved := v_unresolved || jsonb_build_object('table','meat_factory_raw_materials','id',r.id,'reason','missing_item_code'); CONTINUE;
    END IF;
    SELECT id INTO v_item_id FROM public.inventory_items
      WHERE warehouse_id=v_wh AND module='meat_factory' AND category=COALESCE(r.category,'مواد خام') AND item_code=r.material_code;
    IF v_item_id IS NULL THEN
      INSERT INTO public.inventory_items(warehouse_id,name,category,sku,unit,stock,unit_cost,module,item_code,is_active)
      VALUES (v_wh, COALESCE(r.name_ar,r.material_code), COALESCE(r.category,'مواد خام'), r.material_code, r.default_unit, COALESCE(r.stock,0), COALESCE(r.avg_unit_cost,0),'meat_factory',r.material_code, COALESCE(r.is_active,true))
      RETURNING id INTO v_item_id;
    END IF;
    UPDATE public.meat_factory_raw_materials SET inventory_item_id=v_item_id WHERE id=r.id;
    v_meat := v_meat + 1;
  END LOOP;

  FOR r IN SELECT * FROM public.feed_raw_materials WHERE inventory_item_id IS NULL LOOP
    IF COALESCE(r.is_packaging,false) THEN CONTINUE; END IF;
    DECLARE v_code text := COALESCE(NULLIF(r.item_code,''),'FRM-'||substring(r.id::text,1,8));
    BEGIN
      SELECT id INTO v_item_id FROM public.inventory_items
        WHERE warehouse_id=v_wh AND module='feed_factory' AND category=COALESCE(r.category,'مواد خام') AND item_code=v_code;
      IF v_item_id IS NULL THEN
        INSERT INTO public.inventory_items(warehouse_id,name,category,sku,unit,stock,unit_cost,module,item_code,is_active)
        VALUES (v_wh, COALESCE(r.name,v_code), COALESCE(r.category,'مواد خام'), v_code, r.unit, COALESCE(r.stock,0), COALESCE(r.unit_cost,0),'feed_factory',v_code, COALESCE(r.is_active,true))
        RETURNING id INTO v_item_id;
      END IF;
      UPDATE public.feed_raw_materials SET inventory_item_id=v_item_id WHERE id=r.id;
      v_feed := v_feed + 1;
    END;
  END LOOP;

  FOR r IN SELECT * FROM public.packaging_materials WHERE inventory_item_id IS NULL LOOP
    IF r.code IS NULL OR r.code='' THEN
      v_unresolved := v_unresolved || jsonb_build_object('table','packaging_materials','id',r.id,'reason','missing_code'); CONTINUE;
    END IF;
    SELECT id INTO v_item_id FROM public.inventory_items
      WHERE warehouse_id=v_wh AND module=COALESCE(r.module,'general') AND category='تغليف' AND item_code=r.code;
    IF v_item_id IS NULL THEN
      INSERT INTO public.inventory_items(warehouse_id,name,category,sku,unit,stock,unit_cost,module,item_code,is_active)
      VALUES (v_wh, COALESCE(r.name_ar,r.code),'تغليف', r.code, r.unit, COALESCE(r.stock,0), COALESCE(r.unit_cost,0), COALESCE(r.module,'general'), r.code, COALESCE(r.is_active,true))
      RETURNING id INTO v_item_id;
    END IF;
    UPDATE public.packaging_materials SET inventory_item_id=v_item_id WHERE id=r.id;
    v_pack := v_pack + 1;
  END LOOP;

  FOR r IN SELECT * FROM public.meat_factory_products WHERE inventory_item_id IS NULL LOOP
    IF NOT COALESCE(r.is_active,false) OR r.barcode IS NULL THEN
      v_unresolved := v_unresolved || jsonb_build_object('table','meat_factory_products','id',r.id,'product_code',r.product_code,'reason','inactive_or_missing_barcode'); CONTINUE;
    END IF;
    SELECT id INTO v_item_id FROM public.inventory_items
      WHERE warehouse_id=v_wh AND module='meat_factory' AND category='منتج تام' AND item_code=r.product_code;
    IF v_item_id IS NULL THEN
      INSERT INTO public.inventory_items(warehouse_id,name,category,sku,unit,stock,unit_cost,module,item_code,is_active)
      VALUES (v_wh, COALESCE(r.name_ar,r.product_code),'منتج تام', r.product_code, COALESCE(r.package_unit,'كجم'), 0, COALESCE(r.cost_price,0),'meat_factory', r.product_code, true)
      RETURNING id INTO v_item_id;
    END IF;
    UPDATE public.meat_factory_products SET inventory_item_id=v_item_id WHERE id=r.id;
    v_meatp := v_meatp + 1;
  END LOOP;

  FOR r IN SELECT * FROM public.feed_products WHERE inventory_item_id IS NULL AND archived_at IS NULL LOOP
    SELECT id INTO v_item_id FROM public.inventory_items
      WHERE warehouse_id=v_wh AND module='feed_factory' AND category='منتج تام' AND item_code=r.feed_code;
    IF v_item_id IS NULL THEN
      INSERT INTO public.inventory_items(warehouse_id,name,category,sku,unit,stock,unit_cost,module,item_code,is_active)
      VALUES (v_wh, COALESCE(r.name,r.feed_code),'منتج تام', r.feed_code,'كجم', COALESCE(r.current_stock,0), COALESCE(r.latest_unit_cost,0),'feed_factory', r.feed_code, true)
      RETURNING id INTO v_item_id;
    END IF;
    UPDATE public.feed_products SET inventory_item_id=v_item_id WHERE id=r.id;
    v_feedp := v_feedp + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'warehouse_id', v_wh,
    'meat_materials_linked', v_meat, 'feed_materials_linked', v_feed,
    'packaging_linked', v_pack, 'meat_products_linked', v_meatp, 'feed_products_linked', v_feedp,
    'unresolved', v_unresolved
  );
END;$$;
REVOKE EXECUTE ON FUNCTION public.fd_link_factory_items() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.fd_link_factory_items() TO authenticated;

CREATE OR REPLACE FUNCTION public.fd_plan_meat_batch(p_product_code text, p_planned_qty numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_prod public.meat_factory_products; v_active_v int;
  v_items jsonb := '[]'::jsonb; v_blockers jsonb := '[]'::jsonb; v_warnings jsonb := '[]'::jsonb;
  v_total_cost numeric := 0; v_output_total numeric; r record;
BEGIN
  IF v_uid IS NULL OR NOT public.fd_can_manage(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_planned_qty IS NULL OR p_planned_qty<=0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  SELECT * INTO v_prod FROM public.meat_factory_products WHERE product_code=p_product_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF NOT COALESCE(v_prod.is_active,false) THEN v_blockers := v_blockers || jsonb_build_object('code','PRODUCT_INACTIVE'); END IF;
  IF v_prod.barcode IS NULL THEN v_blockers := v_blockers || jsonb_build_object('code','MISSING_BARCODE'); END IF;
  SELECT version INTO v_active_v FROM public.meat_recipe_version_status
   WHERE product_code=p_product_code AND is_active=true ORDER BY version DESC LIMIT 1;
  IF v_active_v IS NULL THEN v_active_v := 1; END IF;
  SELECT SUM(quantity) INTO v_output_total FROM public.meat_factory_recipes
    WHERE product_code=p_product_code AND version=v_active_v AND line_type='output';

  FOR r IN
    SELECT mr.*, mrm.inventory_item_id, mrm.avg_unit_cost,
           ii.stock AS inv_stock, ii.unit_cost AS inv_cost, ii.reserved_qty, ii.blocked_qty
    FROM public.meat_factory_recipes mr
    LEFT JOIN public.meat_factory_raw_materials mrm ON mrm.material_code=mr.material_code
    LEFT JOIN public.inventory_items ii ON ii.id=mrm.inventory_item_id
    WHERE mr.product_code=p_product_code AND mr.version=v_active_v AND mr.line_type='input'
  LOOP
    DECLARE
      v_req numeric := COALESCE(r.quantity,0) * (p_planned_qty / NULLIF(v_output_total,0));
      v_unit_cost numeric := COALESCE(r.inv_cost, r.unit_cost, r.avg_unit_cost, 0);
      v_avail numeric := GREATEST(COALESCE(r.inv_stock,0) - COALESCE(r.reserved_qty,0) - COALESCE(r.blocked_qty,0), 0);
      v_line_cost numeric;
    BEGIN
      IF v_req IS NULL THEN v_req := COALESCE(r.quantity,0); END IF;
      v_line_cost := v_req * v_unit_cost; v_total_cost := v_total_cost + v_line_cost;
      IF r.inventory_item_id IS NULL THEN v_blockers := v_blockers || jsonb_build_object('code','MATERIAL_NOT_LINKED','material_code',r.material_code); END IF;
      IF v_unit_cost = 0 THEN v_warnings := v_warnings || jsonb_build_object('code','ZERO_COST_MATERIAL','material_code',r.material_code); END IF;
      IF v_req > v_avail THEN v_warnings := v_warnings || jsonb_build_object('code','INSUFFICIENT_STOCK','material_code',r.material_code,'required',v_req,'available',v_avail); END IF;
      v_items := v_items || jsonb_build_object(
        'material_code',r.material_code,'material_name_ar',r.material_name_ar,
        'required_qty',v_req,'unit',r.unit,'unit_cost',v_unit_cost,'line_cost',v_line_cost,
        'available_stock',v_avail,'linked',r.inventory_item_id IS NOT NULL
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'product_code',p_product_code,'planned_qty',p_planned_qty,'bom_version',v_active_v,
    'items',v_items,'total_cost_estimate',v_total_cost,
    'cost_per_unit_estimate', CASE WHEN p_planned_qty>0 THEN v_total_cost/p_planned_qty ELSE 0 END,
    'blockers',v_blockers,'warnings',v_warnings
  );
END;$$;
REVOKE EXECUTE ON FUNCTION public.fd_plan_meat_batch(text,numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.fd_plan_meat_batch(text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.fd_plan_feed_batch(p_recipe_id uuid, p_planned_qty numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_rec public.feed_recipes;
  v_items jsonb := '[]'::jsonb; v_blockers jsonb := '[]'::jsonb; v_warnings jsonb := '[]'::jsonb;
  v_total_cost numeric := 0; v_scale numeric; r record;
BEGIN
  IF v_uid IS NULL OR NOT public.fd_can_manage(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_planned_qty IS NULL OR p_planned_qty<=0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  SELECT * INTO v_rec FROM public.feed_recipes WHERE id=p_recipe_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECIPE_NOT_FOUND'; END IF;
  IF COALESCE(v_rec.recipe_status,'') NOT IN ('approved','active') AND NOT COALESCE(v_rec.is_active,false) THEN
    v_blockers := v_blockers || jsonb_build_object('code','RECIPE_NOT_ACTIVE','status',v_rec.recipe_status);
  END IF;
  IF v_rec.source_invoice IS NOT NULL AND v_rec.source_invoice ILIKE '%164%' THEN
    v_blockers := v_blockers || jsonb_build_object('code','INVOICE_164_NEEDS_REVIEW');
  END IF;
  v_scale := p_planned_qty / NULLIF(v_rec.batch_size,0);

  FOR r IN
    SELECT fri.*, frm.inventory_item_id, frm.unit_cost AS frm_cost, frm.stock AS frm_stock,
           ii.stock AS inv_stock, ii.unit_cost AS inv_cost, ii.reserved_qty, ii.blocked_qty,
           frm.name AS material_name
    FROM public.feed_recipe_items fri
    LEFT JOIN public.feed_raw_materials frm ON frm.id=fri.raw_material_id
    LEFT JOIN public.inventory_items ii ON ii.id=frm.inventory_item_id
    WHERE fri.recipe_id=p_recipe_id
  LOOP
    DECLARE
      v_req numeric := COALESCE(r.quantity,0) * COALESCE(v_scale,1);
      v_unit_cost numeric := COALESCE(r.inv_cost, r.unit_cost, r.frm_cost, 0);
      v_avail numeric := GREATEST(COALESCE(r.inv_stock, r.frm_stock, 0) - COALESCE(r.reserved_qty,0) - COALESCE(r.blocked_qty,0), 0);
      v_line_cost numeric := v_req * v_unit_cost;
    BEGIN
      v_total_cost := v_total_cost + v_line_cost;
      IF r.inventory_item_id IS NULL THEN v_blockers := v_blockers || jsonb_build_object('code','MATERIAL_NOT_LINKED','material',r.material_name); END IF;
      IF v_unit_cost = 0 THEN v_warnings := v_warnings || jsonb_build_object('code','ZERO_COST_MATERIAL','material',r.material_name); END IF;
      IF v_req > v_avail THEN v_warnings := v_warnings || jsonb_build_object('code','INSUFFICIENT_STOCK','material',r.material_name,'required',v_req,'available',v_avail); END IF;
      v_items := v_items || jsonb_build_object('material_name',r.material_name,'required_qty',v_req,'unit',r.unit,'unit_cost',v_unit_cost,'line_cost',v_line_cost,'available_stock',v_avail,'linked',r.inventory_item_id IS NOT NULL);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'recipe_id',p_recipe_id,'recipe_name',v_rec.name,'recipe_version',v_rec.version,
    'planned_qty',p_planned_qty,'items',v_items,'total_cost_estimate',v_total_cost,
    'cost_per_kg_estimate', CASE WHEN p_planned_qty>0 THEN v_total_cost/p_planned_qty ELSE 0 END,
    'blockers',v_blockers,'warnings',v_warnings
  );
END;$$;
REVOKE EXECUTE ON FUNCTION public.fd_plan_feed_batch(uuid,numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.fd_plan_feed_batch(uuid,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.fd_create_meat_batch_draft(
  p_product_code text, p_planned_qty numeric, p_production_date date DEFAULT current_date,
  p_notes text DEFAULT NULL, p_label text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_prod public.meat_factory_products; v_active_v int; v_id uuid; v_no text;
BEGIN
  IF v_uid IS NULL OR NOT public.fd_can_manage(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_prod FROM public.meat_factory_products WHERE product_code=p_product_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF NOT COALESCE(v_prod.is_active,false) OR v_prod.barcode IS NULL THEN RAISE EXCEPTION 'PRODUCT_BLOCKED'; END IF;
  SELECT version INTO v_active_v FROM public.meat_recipe_version_status WHERE product_code=p_product_code AND is_active=true ORDER BY version DESC LIMIT 1;
  IF v_active_v IS NULL THEN v_active_v := 1; END IF;
  v_no := COALESCE(p_label,'MB-')||to_char(now(),'YYMMDDHH24MISS')||'-'||substring(gen_random_uuid()::text,1,4);
  INSERT INTO public.meat_factory_batches(batch_number,product_code,product_name_ar,planned_qty,unit,status,production_date,bom_version,notes,created_by)
  VALUES (v_no, p_product_code, v_prod.name_ar, p_planned_qty, COALESCE(v_prod.package_unit,'كجم'),'draft', p_production_date, v_active_v, p_notes, v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END;$$;
REVOKE EXECUTE ON FUNCTION public.fd_create_meat_batch_draft(text,numeric,date,text,text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.fd_create_meat_batch_draft(text,numeric,date,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fd_create_feed_batch_draft(
  p_recipe_id uuid, p_planned_qty numeric, p_production_date date DEFAULT current_date,
  p_notes text DEFAULT NULL, p_label text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_rec public.feed_recipes; v_id uuid; v_no text;
BEGIN
  IF v_uid IS NULL OR NOT public.fd_can_manage(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_rec FROM public.feed_recipes WHERE id=p_recipe_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECIPE_NOT_FOUND'; END IF;
  IF v_rec.source_invoice IS NOT NULL AND v_rec.source_invoice ILIKE '%164%' THEN RAISE EXCEPTION 'INVOICE_164_NEEDS_REVIEW'; END IF;
  v_no := COALESCE(p_label,'FB-')||to_char(now(),'YYMMDDHH24MISS')||'-'||substring(gen_random_uuid()::text,1,4);
  INSERT INTO public.feed_production_batches(batch_number,recipe_id,target_quantity,status,total_cost,production_date,bom_version,feed_product_id,notes,created_by)
  VALUES (v_no, p_recipe_id, p_planned_qty,'draft',0, p_production_date, v_rec.version, v_rec.feed_product_id, p_notes, v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END;$$;
REVOKE EXECUTE ON FUNCTION public.fd_create_feed_batch_draft(uuid,numeric,date,text,text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.fd_create_feed_batch_draft(uuid,numeric,date,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fd_activate_bom_v2(p_product_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_prod public.meat_factory_products; v_blockers jsonb := '[]'::jsonb; v_bad int;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['general_manager','executive_manager','financial_manager']::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  SELECT * INTO v_prod FROM public.meat_factory_products WHERE product_code=p_product_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF NOT COALESCE(v_prod.is_active,false) OR v_prod.barcode IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','PRODUCT_INACTIVE_OR_NO_BARCODE');
  END IF;
  SELECT count(*) INTO v_bad FROM public.meat_factory_recipes mr
    LEFT JOIN public.meat_factory_raw_materials mrm ON mrm.material_code=mr.material_code
    WHERE mr.product_code=p_product_code AND mr.version=2 AND mr.line_type='input' AND mrm.inventory_item_id IS NULL;
  IF v_bad>0 THEN v_blockers := v_blockers || jsonb_build_object('code','UNLINKED_MATERIALS','count',v_bad); END IF;
  SELECT count(*) INTO v_bad FROM public.meat_factory_recipes mr
    JOIN public.meat_factory_raw_materials mrm ON mrm.material_code=mr.material_code
    JOIN public.inventory_items ii ON ii.id=mrm.inventory_item_id
    WHERE mr.product_code=p_product_code AND mr.version=2 AND mr.line_type='input' AND COALESCE(ii.unit_cost,0)=0 AND COALESCE(ii.stock,0)>0;
  IF v_bad>0 THEN v_blockers := v_blockers || jsonb_build_object('code','ZERO_COST_POSITIVE_STOCK','count',v_bad); END IF;
  SELECT count(*) INTO v_bad FROM public.meat_factory_recipes mr
    JOIN public.meat_factory_raw_materials mrm ON mrm.material_code=mr.material_code
    JOIN public.inventory_items ii ON ii.id=mrm.inventory_item_id
    WHERE mr.product_code=p_product_code AND mr.version=2 AND mr.line_type='input' AND COALESCE(ii.stock,0)<0;
  IF v_bad>0 THEN v_blockers := v_blockers || jsonb_build_object('code','NEGATIVE_STOCK_MATERIAL','count',v_bad); END IF;
  SELECT count(*) INTO v_bad FROM public.meat_factory_recipes WHERE product_code=p_product_code AND version=2 AND (unit IS NULL OR unit='');
  IF v_bad>0 THEN v_blockers := v_blockers || jsonb_build_object('code','INVALID_UNITS','count',v_bad); END IF;

  IF jsonb_array_length(v_blockers)>0 THEN
    RETURN jsonb_build_object('activated', false, 'blockers', v_blockers);
  END IF;
  INSERT INTO public.meat_recipe_version_status(product_code, version, status, is_active, activated_by, activated_at)
  VALUES (p_product_code, 2, 'active', true, v_uid, now()) ON CONFLICT DO NOTHING;
  UPDATE public.meat_recipe_version_status SET is_active=false, status='superseded', deactivated_by=v_uid, deactivated_at=now()
   WHERE product_code=p_product_code AND version<>2;
  UPDATE public.meat_recipe_version_status SET is_active=true, status='active', activated_by=v_uid, activated_at=COALESCE(activated_at,now())
   WHERE product_code=p_product_code AND version=2;
  RETURN jsonb_build_object('activated', true, 'product_code', p_product_code);
END;$$;
REVOKE EXECUTE ON FUNCTION public.fd_activate_bom_v2(text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.fd_activate_bom_v2(text) TO authenticated;

DO $$
DECLARE v jsonb;
BEGIN
  v := public.fd_link_factory_items();
  INSERT INTO public.phase6_test_log(label, kind, result) VALUES ('TEST-DISPATCH-D','linking_run', v);
END $$;

DO $$
DECLARE
  v_uid uuid; v_meat_id uuid; v_feed_id uuid; v_prod text; v_rec uuid; v_no text;
BEGIN
  SELECT user_id INTO v_uid FROM public.user_roles WHERE role IN ('general_manager','executive_manager') ORDER BY role LIMIT 1;

  SELECT product_code INTO v_prod FROM public.meat_factory_products
   WHERE is_active=true AND barcode IS NOT NULL ORDER BY created_at ASC LIMIT 1;
  IF v_prod IS NOT NULL THEN
    v_no := 'TEST-DISPATCH-D-MEAT-'||to_char(now(),'YYMMDDHH24MISS');
    INSERT INTO public.meat_factory_batches(batch_number,product_code,product_name_ar,planned_qty,unit,status,production_date,bom_version,notes,created_by)
    SELECT v_no, p.product_code, p.name_ar, 1, COALESCE(p.package_unit,'كجم'),'draft', current_date, 1,
           'TEST-DISPATCH-D safe draft (no post, no approve)', v_uid
    FROM public.meat_factory_products p WHERE p.product_code=v_prod
    RETURNING id INTO v_meat_id;
    INSERT INTO public.phase6_test_log(label, kind, batch_id, result)
    VALUES ('TEST-DISPATCH-D','meat_draft', v_meat_id,
            jsonb_build_object('batch_number',v_no,'product_code',v_prod,'status_reached','draft',
                               'approve_skipped','underlying RPCs meat_batch_submit_review/approve/close + inv_post_movement are not deployed; do not force.'));
  ELSE
    INSERT INTO public.phase6_test_log(label, kind, result)
    VALUES ('TEST-DISPATCH-D','meat_draft', jsonb_build_object('skipped',true,'reason','no active+barcoded meat product available'));
  END IF;

  SELECT id INTO v_rec FROM public.feed_recipes
   WHERE COALESCE(is_active,false)=true AND (source_invoice IS NULL OR source_invoice NOT ILIKE '%164%')
   ORDER BY created_at ASC LIMIT 1;
  IF v_rec IS NOT NULL THEN
    v_no := 'TEST-DISPATCH-D-FEED-'||to_char(now(),'YYMMDDHH24MISS');
    INSERT INTO public.feed_production_batches(batch_number,recipe_id,target_quantity,status,total_cost,production_date,bom_version,feed_product_id,notes,created_by)
    SELECT v_no, r.id, 1, 'draft', 0, current_date, r.version, r.feed_product_id,
           'TEST-DISPATCH-D safe draft (no post, no approve)', v_uid
    FROM public.feed_recipes r WHERE r.id=v_rec
    RETURNING id INTO v_feed_id;
    INSERT INTO public.phase6_test_log(label, kind, batch_id, result)
    VALUES ('TEST-DISPATCH-D','feed_draft', v_feed_id,
            jsonb_build_object('batch_number',v_no,'recipe_id',v_rec,'status_reached','draft','approve_skipped','same reason as meat'));
  ELSE
    INSERT INTO public.phase6_test_log(label, kind, result)
    VALUES ('TEST-DISPATCH-D','feed_draft', jsonb_build_object('skipped',true,'reason','no safe active feed recipe (non-invoice-164) available'));
  END IF;
END $$;
