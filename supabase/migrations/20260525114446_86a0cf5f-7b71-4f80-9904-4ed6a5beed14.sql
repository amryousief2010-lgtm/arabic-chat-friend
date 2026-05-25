
-- ============================================================================
-- DISPATCH D-3 — Persistence, required fields, edit guards
-- ============================================================================

-- 1) Add audit / snapshot columns
ALTER TABLE public.meat_factory_batch_consumption
  ADD COLUMN IF NOT EXISTS line_type   text NOT NULL DEFAULT 'raw_material',
  ADD COLUMN IF NOT EXISTS source      text,
  ADD COLUMN IF NOT EXISTS actual_qty  numeric,
  ADD COLUMN IF NOT EXISTS created_by  uuid,
  ADD COLUMN IF NOT EXISTS updated_by  uuid,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.meat_factory_batch_packaging
  ADD COLUMN IF NOT EXISTS line_type   text NOT NULL DEFAULT 'packaging',
  ADD COLUMN IF NOT EXISTS source      text,
  ADD COLUMN IF NOT EXISTS actual_qty  numeric,
  ADD COLUMN IF NOT EXISTS updated_by  uuid,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.feed_batch_consumption
  ADD COLUMN IF NOT EXISTS line_type     text NOT NULL DEFAULT 'raw_material',
  ADD COLUMN IF NOT EXISTS source        text,
  ADD COLUMN IF NOT EXISTS actual_qty    numeric,
  ADD COLUMN IF NOT EXISTS material_name text,
  ADD COLUMN IF NOT EXISTS unit          text,
  ADD COLUMN IF NOT EXISTS created_by    uuid,
  ADD COLUMN IF NOT EXISTS updated_by    uuid,
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();

-- 2) Lock triggers: only allow edits/deletes while parent batch is in draft/under_review
CREATE OR REPLACE FUNCTION public.lock_meat_consumption_when_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text; v_bid uuid;
BEGIN
  v_bid := COALESCE(NEW.batch_id, OLD.batch_id);
  SELECT status INTO v_status FROM public.meat_factory_batches WHERE id = v_bid;
  IF v_status IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF v_status <> 'draft' THEN RAISE EXCEPTION 'BATCH_LINES_LOCKED: %', v_status; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND v_status NOT IN ('draft','under_review') THEN
    RAISE EXCEPTION 'BATCH_LINES_LOCKED: %', v_status;
  END IF;
  IF TG_OP = 'INSERT' AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'BATCH_LINES_LOCKED_INSERT: %', v_status;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.lock_feed_consumption_when_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text; v_bid uuid;
BEGIN
  v_bid := COALESCE(NEW.batch_id, OLD.batch_id);
  SELECT status INTO v_status FROM public.feed_production_batches WHERE id = v_bid;
  IF v_status IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF v_status NOT IN ('draft','planned') THEN RAISE EXCEPTION 'BATCH_LINES_LOCKED: %', v_status; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND v_status NOT IN ('draft','planned','under_review') THEN
    RAISE EXCEPTION 'BATCH_LINES_LOCKED: %', v_status;
  END IF;
  IF TG_OP = 'INSERT' AND v_status NOT IN ('draft','planned') THEN
    RAISE EXCEPTION 'BATCH_LINES_LOCKED_INSERT: %', v_status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lock_meat_cons ON public.meat_factory_batch_consumption;
CREATE TRIGGER trg_lock_meat_cons
  BEFORE INSERT OR UPDATE OR DELETE ON public.meat_factory_batch_consumption
  FOR EACH ROW EXECUTE FUNCTION public.lock_meat_consumption_when_frozen();

DROP TRIGGER IF EXISTS trg_lock_meat_pack ON public.meat_factory_batch_packaging;
CREATE TRIGGER trg_lock_meat_pack
  BEFORE INSERT OR UPDATE OR DELETE ON public.meat_factory_batch_packaging
  FOR EACH ROW EXECUTE FUNCTION public.lock_meat_consumption_when_frozen();

DROP TRIGGER IF EXISTS trg_lock_feed_cons ON public.feed_batch_consumption;
CREATE TRIGGER trg_lock_feed_cons
  BEFORE INSERT OR UPDATE OR DELETE ON public.feed_batch_consumption
  FOR EACH ROW EXECUTE FUNCTION public.lock_feed_consumption_when_frozen();

-- 3) Fix case-sensitivity bug in fd_plan_meat_batch
CREATE OR REPLACE FUNCTION public.fd_plan_meat_batch(p_product_code text, p_planned_qty numeric)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
    WHERE product_code=p_product_code AND version=v_active_v AND lower(line_type)='output';

  FOR r IN
    SELECT mr.*, mrm.inventory_item_id, mrm.avg_unit_cost,
           ii.stock AS inv_stock, ii.unit_cost AS inv_cost, ii.reserved_qty, ii.blocked_qty, ii.warehouse_id AS inv_wh
    FROM public.meat_factory_recipes mr
    LEFT JOIN public.meat_factory_raw_materials mrm ON mrm.material_code=mr.material_code
    LEFT JOIN public.inventory_items ii ON ii.id=mrm.inventory_item_id
    WHERE mr.product_code=p_product_code AND mr.version=v_active_v AND lower(mr.line_type)='input'
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
        'available_stock',v_avail,'linked',r.inventory_item_id IS NOT NULL,
        'inventory_item_id',r.inventory_item_id,'warehouse_id',r.inv_wh
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'product_code',p_product_code,'planned_qty',p_planned_qty,'bom_version',v_active_v,
    'items',v_items,'total_cost_estimate',v_total_cost,
    'cost_per_unit_estimate', CASE WHEN p_planned_qty>0 THEN v_total_cost/p_planned_qty ELSE 0 END,
    'blockers',v_blockers,'warnings',v_warnings
  );
END;$function$;

-- 4) Persist meat batch consumption snapshot from active BOM
CREATE OR REPLACE FUNCTION public.fd_meat_persist_lines(p_batch_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_b public.meat_factory_batches%ROWTYPE; v_active_v int;
  v_output_total numeric; r record; v_count int := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.fd_can_manage(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.meat_factory_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status <> 'draft' THEN RAISE EXCEPTION 'LINES_FROZEN: %', v_b.status; END IF;

  SELECT version INTO v_active_v FROM public.meat_recipe_version_status
    WHERE product_code=v_b.product_code AND is_active=true ORDER BY version DESC LIMIT 1;
  IF v_active_v IS NULL THEN v_active_v := COALESCE(v_b.bom_version,1); END IF;

  SELECT SUM(quantity) INTO v_output_total FROM public.meat_factory_recipes
    WHERE product_code=v_b.product_code AND version=v_active_v AND lower(line_type)='output';

  DELETE FROM public.meat_factory_batch_consumption WHERE batch_id=p_batch_id;
  DELETE FROM public.meat_factory_batch_packaging  WHERE batch_id=p_batch_id;

  FOR r IN
    SELECT mr.material_code, mr.material_name_ar, mr.quantity, mr.unit,
           mrm.inventory_item_id, mrm.avg_unit_cost,
           ii.unit_cost AS inv_cost, ii.warehouse_id AS inv_wh
    FROM public.meat_factory_recipes mr
    LEFT JOIN public.meat_factory_raw_materials mrm ON mrm.material_code=mr.material_code
    LEFT JOIN public.inventory_items ii ON ii.id=mrm.inventory_item_id
    WHERE mr.product_code=v_b.product_code AND mr.version=v_active_v AND lower(mr.line_type)='input'
  LOOP
    DECLARE
      v_req numeric := COALESCE(r.quantity,0) * (v_b.planned_qty / NULLIF(v_output_total,0));
      v_uc numeric := COALESCE(r.inv_cost, r.avg_unit_cost, 0);
    BEGIN
      IF v_req IS NULL OR v_req<=0 THEN v_req := COALESCE(r.quantity,0); END IF;
      INSERT INTO public.meat_factory_batch_consumption(
        batch_id, material_code, material_name_ar, quantity, actual_qty, unit, unit_cost, line_total,
        inventory_item_id, warehouse_id, line_type, source, created_by, updated_by
      ) VALUES (
        p_batch_id, r.material_code, r.material_name_ar, v_req, v_req, COALESCE(r.unit,'كجم'),
        v_uc, v_req*v_uc, r.inventory_item_id, r.inv_wh,
        'raw_material', 'BOM v'||v_active_v, v_uid, v_uid
      );
      v_count := v_count + 1;
    END;
  END LOOP;

  UPDATE public.meat_factory_batches
    SET bom_version=v_active_v, updated_at=now()
    WHERE id=p_batch_id;

  RETURN jsonb_build_object('success',true,'lines_inserted',v_count,'bom_version',v_active_v);
END $function$;

-- 5) Persist feed batch consumption snapshot from active recipe
CREATE OR REPLACE FUNCTION public.fd_feed_persist_lines(p_batch_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_b public.feed_production_batches%ROWTYPE; v_rec public.feed_recipes%ROWTYPE;
  r record; v_scale numeric; v_count int := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.fd_can_manage(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.feed_production_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status NOT IN ('draft','planned') THEN RAISE EXCEPTION 'LINES_FROZEN: %', v_b.status; END IF;

  SELECT * INTO v_rec FROM public.feed_recipes WHERE id=v_b.recipe_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECIPE_NOT_FOUND'; END IF;
  v_scale := v_b.target_quantity / NULLIF(v_rec.batch_size,0);

  DELETE FROM public.feed_batch_consumption WHERE batch_id=p_batch_id;

  FOR r IN
    SELECT fri.raw_material_id, fri.quantity, fri.unit,
           frm.name AS material_name, frm.unit_cost AS frm_cost, frm.inventory_item_id,
           ii.unit_cost AS inv_cost, ii.warehouse_id AS inv_wh
    FROM public.feed_recipe_items fri
    LEFT JOIN public.feed_raw_materials frm ON frm.id=fri.raw_material_id
    LEFT JOIN public.inventory_items ii ON ii.id=frm.inventory_item_id
    WHERE fri.recipe_id=v_b.recipe_id
  LOOP
    DECLARE
      v_req numeric := COALESCE(r.quantity,0) * COALESCE(v_scale,1);
      v_uc numeric := COALESCE(r.inv_cost, r.frm_cost, 0);
    BEGIN
      INSERT INTO public.feed_batch_consumption(
        batch_id, raw_material_id, quantity, actual_qty, unit_cost, total_cost,
        inventory_item_id, warehouse_id, material_name, unit,
        line_type, source, created_by, updated_by
      ) VALUES (
        p_batch_id, r.raw_material_id, v_req, v_req, v_uc, v_req*v_uc,
        r.inventory_item_id, r.inv_wh, r.material_name, r.unit,
        'raw_material', 'Recipe v'||COALESCE(v_rec.version,1), v_uid, v_uid
      );
      v_count := v_count + 1;
    END;
  END LOOP;

  UPDATE public.feed_production_batches SET bom_version=COALESCE(v_rec.version,1), updated_at=now() WHERE id=p_batch_id;
  RETURN jsonb_build_object('success',true,'lines_inserted',v_count,'recipe_version',v_rec.version);
END $function$;

-- 6) Resolve finished inventory item helpers
CREATE OR REPLACE FUNCTION public.fd_resolve_meat_finished_item(p_product_code text, p_warehouse_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.inventory_items
   WHERE warehouse_id=p_warehouse_id
     AND module='meat_factory'
     AND (item_code=p_product_code OR sku=p_product_code)
   ORDER BY unit_cost DESC NULLS LAST, created_at DESC
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fd_resolve_feed_finished_item(p_feed_product_id uuid, p_warehouse_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(
    (SELECT fp.inventory_item_id FROM public.feed_products fp WHERE fp.id=p_feed_product_id),
    (SELECT ii.id FROM public.feed_products fp
       JOIN public.inventory_items ii
         ON ii.warehouse_id=p_warehouse_id AND ii.module='feed_factory'
        AND (ii.name=fp.name)
      WHERE fp.id=p_feed_product_id LIMIT 1)
  );
$$;

-- 7) Setter RPCs for required batch fields
CREATE OR REPLACE FUNCTION public.fd_meat_set_fields(
  p_batch_id uuid,
  p_target_warehouse_id uuid DEFAULT NULL,
  p_finished_item_id    uuid DEFAULT NULL,
  p_actual_qty          numeric DEFAULT NULL,
  p_labor_cost          numeric DEFAULT NULL,
  p_service_cost        numeric DEFAULT NULL,
  p_other_expenses      numeric DEFAULT NULL,
  p_waste_qty           numeric DEFAULT NULL,
  p_waste_cost          numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_b public.meat_factory_batches%ROWTYPE; v_fid uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.fd_can_manage(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.meat_factory_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status IN ('closed','cancelled') THEN RAISE EXCEPTION 'BATCH_FROZEN: %', v_b.status; END IF;

  v_fid := p_finished_item_id;
  IF v_fid IS NULL AND p_target_warehouse_id IS NOT NULL THEN
    v_fid := public.fd_resolve_meat_finished_item(v_b.product_code, p_target_warehouse_id);
  END IF;

  UPDATE public.meat_factory_batches SET
    target_warehouse_id      = COALESCE(p_target_warehouse_id, target_warehouse_id),
    finished_inventory_item_id = COALESCE(v_fid, finished_inventory_item_id),
    actual_qty               = COALESCE(p_actual_qty, actual_qty),
    labor_cost               = COALESCE(p_labor_cost, labor_cost),
    service_cost             = COALESCE(p_service_cost, service_cost),
    other_expenses           = COALESCE(p_other_expenses, other_expenses),
    waste_qty                = COALESCE(p_waste_qty, waste_qty),
    waste_cost               = COALESCE(p_waste_cost, waste_cost),
    updated_at               = now()
  WHERE id=p_batch_id;
  RETURN jsonb_build_object('success',true,'finished_inventory_item_id',v_fid);
END $$;

CREATE OR REPLACE FUNCTION public.fd_feed_set_fields(
  p_batch_id uuid,
  p_target_warehouse_id uuid DEFAULT NULL,
  p_finished_item_id    uuid DEFAULT NULL,
  p_actual_qty          numeric DEFAULT NULL,
  p_labor_cost          numeric DEFAULT NULL,
  p_service_cost        numeric DEFAULT NULL,
  p_other_cost          numeric DEFAULT NULL,
  p_waste_qty           numeric DEFAULT NULL,
  p_waste_cost          numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_b public.feed_production_batches%ROWTYPE; v_fid uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.fd_can_manage(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_b FROM public.feed_production_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status IN ('closed','cancelled') THEN RAISE EXCEPTION 'BATCH_FROZEN: %', v_b.status; END IF;

  v_fid := p_finished_item_id;
  IF v_fid IS NULL AND v_b.feed_product_id IS NOT NULL AND p_target_warehouse_id IS NOT NULL THEN
    v_fid := public.fd_resolve_feed_finished_item(v_b.feed_product_id, p_target_warehouse_id);
  END IF;

  UPDATE public.feed_production_batches SET
    target_warehouse_id      = COALESCE(p_target_warehouse_id, target_warehouse_id),
    finished_inventory_item_id = COALESCE(v_fid, finished_inventory_item_id),
    actual_quantity          = COALESCE(p_actual_qty, actual_quantity),
    labor_cost               = COALESCE(p_labor_cost, labor_cost),
    service_cost             = COALESCE(p_service_cost, service_cost),
    other_cost               = COALESCE(p_other_cost, other_cost),
    waste_qty                = COALESCE(p_waste_qty, waste_qty),
    waste_cost               = COALESCE(p_waste_cost, waste_cost),
    updated_at               = now()
  WHERE id=p_batch_id;
  RETURN jsonb_build_object('success',true,'finished_inventory_item_id',v_fid);
END $$;

-- 8) Edit consumption qty (before approval only)
CREATE OR REPLACE FUNCTION public.fd_meat_edit_consumption_qty(p_line_id uuid, p_actual_qty numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_l record; v_status text;
BEGIN
  IF v_uid IS NULL OR NOT public.fd_can_manage(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_actual_qty IS NULL OR p_actual_qty<0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  SELECT c.*, b.status INTO v_l FROM public.meat_factory_batch_consumption c
    JOIN public.meat_factory_batches b ON b.id=c.batch_id WHERE c.id=p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_l.status NOT IN ('draft','under_review') THEN RAISE EXCEPTION 'BATCH_FROZEN: %', v_l.status; END IF;
  UPDATE public.meat_factory_batch_consumption
    SET actual_qty=p_actual_qty, quantity=p_actual_qty,
        line_total=p_actual_qty*unit_cost, updated_by=v_uid, updated_at=now()
    WHERE id=p_line_id;
  RETURN jsonb_build_object('success',true);
END $$;

CREATE OR REPLACE FUNCTION public.fd_feed_edit_consumption_qty(p_line_id uuid, p_actual_qty numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_l record;
BEGIN
  IF v_uid IS NULL OR NOT public.fd_can_manage(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_actual_qty IS NULL OR p_actual_qty<0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  SELECT c.*, b.status INTO v_l FROM public.feed_batch_consumption c
    JOIN public.feed_production_batches b ON b.id=c.batch_id WHERE c.id=p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_l.status NOT IN ('draft','planned','under_review') THEN RAISE EXCEPTION 'BATCH_FROZEN: %', v_l.status; END IF;
  UPDATE public.feed_batch_consumption
    SET actual_qty=p_actual_qty, quantity=p_actual_qty,
        total_cost=p_actual_qty*unit_cost, updated_by=v_uid, updated_at=now()
    WHERE id=p_line_id;
  RETURN jsonb_build_object('success',true);
END $$;
