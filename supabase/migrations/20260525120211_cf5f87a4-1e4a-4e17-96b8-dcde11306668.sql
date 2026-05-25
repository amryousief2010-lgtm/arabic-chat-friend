
CREATE OR REPLACE FUNCTION public.lock_feed_consumption_when_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_status text; v_bid uuid; v_posted_only boolean;
BEGIN
  v_bid := COALESCE(NEW.batch_id, OLD.batch_id);
  SELECT status INTO v_status FROM public.feed_production_batches WHERE id = v_bid;
  IF v_status IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_status NOT IN ('draft','planned') THEN RAISE EXCEPTION 'BATCH_LINES_LOCKED: %', v_status; END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_posted_only := (NEW.posted_movement_id IS DISTINCT FROM OLD.posted_movement_id)
      AND NEW.batch_id IS NOT DISTINCT FROM OLD.batch_id
      AND NEW.raw_material_id IS NOT DISTINCT FROM OLD.raw_material_id
      AND NEW.inventory_item_id IS NOT DISTINCT FROM OLD.inventory_item_id
      AND NEW.warehouse_id IS NOT DISTINCT FROM OLD.warehouse_id
      AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
      AND NEW.actual_qty IS NOT DISTINCT FROM OLD.actual_qty
      AND NEW.unit_cost IS NOT DISTINCT FROM OLD.unit_cost
      AND NEW.total_cost IS NOT DISTINCT FROM OLD.total_cost
      AND NEW.line_type IS NOT DISTINCT FROM OLD.line_type
      AND NEW.source IS NOT DISTINCT FROM OLD.source;
    IF v_status NOT IN ('draft','planned','under_review') AND NOT v_posted_only THEN
      RAISE EXCEPTION 'BATCH_LINES_LOCKED: %', v_status;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND v_status NOT IN ('draft','planned') THEN
    RAISE EXCEPTION 'BATCH_LINES_LOCKED_INSERT: %', v_status;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.lock_meat_consumption_when_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_status text; v_bid uuid; v_posted_only boolean;
BEGIN
  v_bid := COALESCE(NEW.batch_id, OLD.batch_id);
  SELECT status INTO v_status FROM public.meat_factory_batches WHERE id = v_bid;
  IF v_status IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_status <> 'draft' THEN RAISE EXCEPTION 'BATCH_LINES_LOCKED: %', v_status; END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_posted_only := (NEW.posted_movement_id IS DISTINCT FROM OLD.posted_movement_id)
      AND NEW.batch_id IS NOT DISTINCT FROM OLD.batch_id
      AND NEW.material_code IS NOT DISTINCT FROM OLD.material_code
      AND NEW.inventory_item_id IS NOT DISTINCT FROM OLD.inventory_item_id
      AND NEW.warehouse_id IS NOT DISTINCT FROM OLD.warehouse_id
      AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
      AND NEW.actual_qty IS NOT DISTINCT FROM OLD.actual_qty
      AND NEW.unit_cost IS NOT DISTINCT FROM OLD.unit_cost
      AND NEW.line_total IS NOT DISTINCT FROM OLD.line_total
      AND NEW.line_type IS NOT DISTINCT FROM OLD.line_type
      AND NEW.source IS NOT DISTINCT FROM OLD.source;
    IF v_status NOT IN ('draft','under_review') AND NOT v_posted_only THEN
      RAISE EXCEPTION 'BATCH_LINES_LOCKED: %', v_status;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'BATCH_LINES_LOCKED_INSERT: %', v_status;
  END IF;
  RETURN NEW;
END $$;

-- Mirror for packaging lock if it exists with same structure
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='lock_meat_packaging_when_frozen' AND pronamespace='public'::regnamespace) THEN
  EXECUTE $sql$
  CREATE OR REPLACE FUNCTION public.lock_meat_packaging_when_frozen()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $body$
  DECLARE v_status text; v_bid uuid; v_posted_only boolean;
  BEGIN
    v_bid := COALESCE(NEW.batch_id, OLD.batch_id);
    SELECT status INTO v_status FROM public.meat_factory_batches WHERE id = v_bid;
    IF v_status IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
    IF TG_OP = 'DELETE' THEN
      IF v_status <> 'draft' THEN RAISE EXCEPTION 'BATCH_LINES_LOCKED: %', v_status; END IF;
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      v_posted_only := (NEW.posted_movement_id IS DISTINCT FROM OLD.posted_movement_id)
        AND NEW.batch_id IS NOT DISTINCT FROM OLD.batch_id
        AND NEW.packaging_material_id IS NOT DISTINCT FROM OLD.packaging_material_id
        AND NEW.inventory_item_id IS NOT DISTINCT FROM OLD.inventory_item_id
        AND NEW.warehouse_id IS NOT DISTINCT FROM OLD.warehouse_id
        AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
        AND NEW.actual_qty IS NOT DISTINCT FROM OLD.actual_qty
        AND NEW.unit_cost IS NOT DISTINCT FROM OLD.unit_cost
        AND NEW.line_total IS NOT DISTINCT FROM OLD.line_total;
      IF v_status NOT IN ('draft','under_review') AND NOT v_posted_only THEN
        RAISE EXCEPTION 'BATCH_LINES_LOCKED: %', v_status;
      END IF;
    END IF;
    IF TG_OP = 'INSERT' AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'BATCH_LINES_LOCKED_INSERT: %', v_status;
    END IF;
    RETURN NEW;
  END $body$;
  $sql$;
END IF;
END $$;
