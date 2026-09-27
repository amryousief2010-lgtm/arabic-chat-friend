-- Closed loop for every warehouse that still moves quantity.
-- Baseline for the card ledger stays the stocktake approved at or after
-- 2026-09-30 Africa/Cairo. Opening balances posted on 2 Jun and 18 Jun
-- stay in history and are not added on top of that stocktake.

-- ---------------------------------------------------------------------------
-- Packaging switch. The owner has not chosen the single packaging store.
-- The live September consumption is meat_factory_raw_items (kind packaging).
-- Changing the row is the switch; do not merge the four historical balances.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.packaging_store_setting (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_packaging_store text NOT NULL DEFAULT 'meat_factory_raw_items',
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.packaging_store_setting (id, active_packaging_store, note)
VALUES (
  1,
  'meat_factory_raw_items',
  'بانتظار قرار المالك. الاستهلاك الحي في سبتمبر مسجّل على خامات مصنع اللحوم من نوع تغليف. تبديل المخزن صف واحد هنا.'
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.packaging_store_name()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.active_packaging_store
    FROM public.packaging_store_setting s
   WHERE s.id = 1
$$;

COMMENT ON FUNCTION public.packaging_store_name() IS
  'مخزن التغليف الفعّال. القيمة الحالية meat_factory_raw_items حتى يقرر المالك. لا تُدمج أرصدة التغليف الأربعة.';

REVOKE ALL ON FUNCTION public.packaging_store_name() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.packaging_store_name() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Separate-store ledger: feed raw, feed products, slaughter feed, brooding
-- feed, and meat-factory product cards (shortage return). meat_factory_raw_items
-- already posts through post_meat_raw_movement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.separate_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name text NOT NULL,
  item_id uuid NOT NULL,
  direction text NOT NULL,
  quantity numeric NOT NULL,
  stock_before numeric NOT NULL,
  stock_after numeric NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  source_line_id text NOT NULL,
  reason text,
  unit_cost numeric,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT separate_stock_movements_source_key
    UNIQUE (store_name, source_type, source_id, source_line_id)
);

CREATE INDEX IF NOT EXISTS separate_stock_movements_item_idx
  ON public.separate_stock_movements (store_name, item_id, created_at);

ALTER TABLE public.separate_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS separate_stock_movements_read ON public.separate_stock_movements;
CREATE POLICY separate_stock_movements_read ON public.separate_stock_movements
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.separate_stock_movements TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_separate_stock_movement_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.named_stock_write', true) = 'on'
     OR current_setting('app.named_stock_armed', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'NAMED_MOVEMENT_IMMUTABLE: حركة المخزن المنفصل لا تُعدَّل إلا عبر الترحيل';
END;
$$;

DROP TRIGGER IF EXISTS trg_00_separate_stock_movement_immutable ON public.separate_stock_movements;
CREATE TRIGGER trg_00_separate_stock_movement_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.separate_stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.reject_separate_stock_movement_write();

CREATE OR REPLACE FUNCTION public.guard_named_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_line text;
  v_src_type text;
  v_src_id text;
  v_reason text;
BEGIN
  IF TG_TABLE_NAME = 'feed_raw_materials' THEN
    v_before := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.stock END;
    v_after := NEW.stock;
  ELSIF TG_TABLE_NAME = 'feed_products' THEN
    v_before := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.current_stock END;
    v_after := NEW.current_stock;
  ELSIF TG_TABLE_NAME = 'slaughterhouse_feed_inventory' THEN
    v_before := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.current_kg END;
    v_after := NEW.current_kg;
  ELSIF TG_TABLE_NAME = 'brooding_feed_inventory' THEN
    v_before := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.current_kg END;
    v_after := NEW.current_kg;
  ELSIF TG_TABLE_NAME = 'meat_factory_products' THEN
    v_before := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.current_stock END;
    v_after := NEW.current_stock;
  ELSE
    RETURN NEW;
  END IF;

  IF v_before IS NOT DISTINCT FROM v_after THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND COALESCE(v_after, 0) = 0 THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.named_stock_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(current_setting('app.named_stock_armed', true), '') IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'NAMED_STOCK_DIRECT_WRITE: تعديل رصيد % مرفوض. استخدم post_named_stock', TG_TABLE_NAME;
  END IF;

  v_src_type := current_setting('app.named_stock_source_type', true);
  v_src_id := current_setting('app.named_stock_source_id', true);
  v_line := COALESCE(current_setting('app.named_stock_source_line', true), 'step') || ':' || NEW.id::text;
  v_reason := current_setting('app.named_stock_reason', true);

  IF v_src_type IS NULL OR btrim(v_src_type) = '' OR v_src_id IS NULL OR btrim(v_src_id) = '' THEN
    RAISE EXCEPTION 'NAMED_STOCK_SOURCE_REQUIRED: حركة % بلا مفتاح مستند', TG_TABLE_NAME;
  END IF;

  INSERT INTO public.separate_stock_movements(
    store_name, item_id, direction, quantity, stock_before, stock_after,
    source_type, source_id, source_line_id, reason, created_by
  ) VALUES (
    TG_TABLE_NAME, NEW.id,
    CASE WHEN v_after > v_before THEN 'in' WHEN v_after < v_before THEN 'out' ELSE 'set' END,
    abs(v_after - v_before), v_before, v_after,
    v_src_type, v_src_id::uuid, v_line, v_reason, auth.uid()
  )
  ON CONFLICT (store_name, source_type, source_id, source_line_id) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAMED_STOCK_ALREADY_POSTED: % % %', TG_TABLE_NAME, v_src_type, v_src_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_named_stock_feed_raw ON public.feed_raw_materials;
CREATE TRIGGER trg_00_named_stock_feed_raw
  BEFORE INSERT OR UPDATE OF stock ON public.feed_raw_materials
  FOR EACH ROW EXECUTE FUNCTION public.guard_named_stock();

DROP TRIGGER IF EXISTS trg_00_named_stock_feed_products ON public.feed_products;
CREATE TRIGGER trg_00_named_stock_feed_products
  BEFORE INSERT OR UPDATE OF current_stock ON public.feed_products
  FOR EACH ROW EXECUTE FUNCTION public.guard_named_stock();

DROP TRIGGER IF EXISTS trg_00_named_stock_slaughter_feed ON public.slaughterhouse_feed_inventory;
CREATE TRIGGER trg_00_named_stock_slaughter_feed
  BEFORE INSERT OR UPDATE OF current_kg ON public.slaughterhouse_feed_inventory
  FOR EACH ROW EXECUTE FUNCTION public.guard_named_stock();

DROP TRIGGER IF EXISTS trg_00_named_stock_brooding_feed ON public.brooding_feed_inventory;
CREATE TRIGGER trg_00_named_stock_brooding_feed
  BEFORE INSERT OR UPDATE OF current_kg ON public.brooding_feed_inventory
  FOR EACH ROW EXECUTE FUNCTION public.guard_named_stock();

DROP TRIGGER IF EXISTS trg_00_named_stock_mf_products ON public.meat_factory_products;
CREATE TRIGGER trg_00_named_stock_mf_products
  BEFORE INSERT OR UPDATE OF current_stock ON public.meat_factory_products
  FOR EACH ROW EXECUTE FUNCTION public.guard_named_stock();

CREATE OR REPLACE FUNCTION public.post_named_stock(
  p_store text,
  p_item_id uuid,
  p_delta numeric,
  p_source_type text,
  p_source_id uuid,
  p_source_line text,
  p_reason text,
  p_unit_cost numeric DEFAULT NULL,
  p_effect text DEFAULT 'delta',
  p_target numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_existing uuid;
  v_line text := btrim(COALESCE(p_source_line, ''));
BEGIN
  IF auth.uid() IS NOT NULL
     AND COALESCE(current_setting('app.named_stock_internal', true), '') IS DISTINCT FROM 'on'
     AND NOT public.has_any_role(auth.uid(), ARRAY[
       'general_manager'::public.app_role,
       'executive_manager'::public.app_role,
       'feed_factory_manager'::public.app_role,
       'warehouse_supervisor'::public.app_role,
       'meat_factory_manager'::public.app_role,
       'slaughterhouse_manager'::public.app_role,
       'production_manager'::public.app_role,
       'brooding_manager'::public.app_role,
       'accountant'::public.app_role,
       'financial_manager'::public.app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_store IS NULL OR p_item_id IS NULL OR p_source_type IS NULL OR p_source_id IS NULL OR v_line = '' THEN
    RAISE EXCEPTION 'NAMED_STOCK_SOURCE_REQUIRED';
  END IF;
  IF p_store NOT IN (
    'feed_raw_materials', 'feed_products', 'slaughterhouse_feed_inventory',
    'brooding_feed_inventory', 'meat_factory_products'
  ) THEN
    RAISE EXCEPTION 'UNKNOWN_NAMED_STORE: %', p_store;
  END IF;

  SELECT id INTO v_existing
    FROM public.separate_stock_movements
   WHERE store_name = p_store
     AND source_type = p_source_type
     AND source_id = p_source_id
     AND source_line_id = v_line;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_posted', 'id', v_existing);
  END IF;

  PERFORM set_config('app.named_stock_write', 'on', true);

  IF p_store = 'feed_raw_materials' THEN
    SELECT stock INTO v_before FROM public.feed_raw_materials WHERE id = p_item_id FOR UPDATE;
  ELSIF p_store = 'feed_products' THEN
    SELECT current_stock INTO v_before FROM public.feed_products WHERE id = p_item_id FOR UPDATE;
  ELSIF p_store = 'slaughterhouse_feed_inventory' THEN
    SELECT current_kg INTO v_before FROM public.slaughterhouse_feed_inventory WHERE id = p_item_id FOR UPDATE;
  ELSIF p_store = 'brooding_feed_inventory' THEN
    SELECT current_kg INTO v_before FROM public.brooding_feed_inventory WHERE id = p_item_id FOR UPDATE;
  ELSE
    SELECT current_stock INTO v_before FROM public.meat_factory_products WHERE id = p_item_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    PERFORM set_config('app.named_stock_write', 'off', true);
    RAISE EXCEPTION 'NAMED_STOCK_ITEM_NOT_FOUND';
  END IF;

  IF COALESCE(p_effect, 'delta') = 'set' THEN
    v_after := COALESCE(p_target, v_before);
  ELSE
    v_after := COALESCE(v_before, 0) + COALESCE(p_delta, 0);
  END IF;
  IF v_after < 0 THEN
    PERFORM set_config('app.named_stock_write', 'off', true);
    RAISE EXCEPTION 'NAMED_STOCK_INSUFFICIENT: الرصيد % والحركة تصله إلى %', v_before, v_after;
  END IF;

  INSERT INTO public.separate_stock_movements(
    store_name, item_id, direction, quantity, stock_before, stock_after,
    source_type, source_id, source_line_id, reason, unit_cost, created_by
  ) VALUES (
    p_store, p_item_id,
    CASE WHEN v_after > v_before THEN 'in' WHEN v_after < v_before THEN 'out' ELSE 'set' END,
    abs(v_after - v_before), v_before, v_after,
    p_source_type, p_source_id, v_line, p_reason, p_unit_cost, auth.uid()
  );

  IF p_store = 'feed_raw_materials' THEN
    UPDATE public.feed_raw_materials
       SET stock = v_after,
           unit_cost = CASE WHEN p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN p_unit_cost ELSE unit_cost END,
           updated_at = now()
     WHERE id = p_item_id;
  ELSIF p_store = 'feed_products' THEN
    UPDATE public.feed_products
       SET current_stock = v_after,
           latest_unit_cost = CASE WHEN p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN p_unit_cost ELSE latest_unit_cost END,
           updated_at = now()
     WHERE id = p_item_id;
  ELSIF p_store = 'slaughterhouse_feed_inventory' THEN
    UPDATE public.slaughterhouse_feed_inventory
       SET current_kg = v_after,
           last_unit_cost = CASE WHEN p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN p_unit_cost ELSE last_unit_cost END,
           updated_at = now()
     WHERE id = p_item_id;
  ELSIF p_store = 'brooding_feed_inventory' THEN
    UPDATE public.brooding_feed_inventory
       SET current_kg = v_after,
           last_unit_cost = CASE WHEN p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN p_unit_cost ELSE last_unit_cost END,
           updated_at = now()
     WHERE id = p_item_id;
  ELSE
    UPDATE public.meat_factory_products
       SET current_stock = v_after,
           latest_unit_cost = CASE WHEN p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN p_unit_cost ELSE latest_unit_cost END,
           updated_at = now()
     WHERE id = p_item_id;
  END IF;

  PERFORM set_config('app.named_stock_write', 'off', true);
  RETURN jsonb_build_object('status', 'posted', 'before', v_before, 'after', v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.post_named_stock(text, uuid, numeric, text, uuid, text, text, numeric, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_named_stock(text, uuid, numeric, text, uuid, text, text, numeric, text, numeric) TO authenticated, service_role;

-- Arm the current feed/brooding/slaughter flows so their existing stock
-- arithmetic writes a before/after movement with a stable source key.
DO $inj$
DECLARE
  r record;
  def text;
  pos int;
  n int;
  expr text;
  changed boolean;
  marked int;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = ANY (ARRAY[
         'apply_feed_production_item','apply_feed_raw_purchase_item','apply_feed_sale_item',
         'apply_feed_stock_count','approve_feed_batch_cost','approve_feed_production_invoice',
         'approve_feed_sales_return','brooding_feed_deduct_inventory','brooding_feed_stock_apply',
         'cancel_feed_sales_return','edit_approved_feed_production_invoice','feed_apply_issue',
         'feed_batch_cancel','finalize_meat_production','fob_apply_on_approval',
         'meat_factory_adjust_stock','meat_production_transfer_to_main',
         'reject_meat_production_transfer','revert_feed_production_invoice_on_delete',
         'revert_feed_production_item','revert_feed_raw_purchase_item','revert_feed_sale_item',
         'slaughterhouse_feed_apply'
       ])
  LOOP
    def := r.def;
    IF def LIKE '%app.named_stock_source_type%' THEN
      CONTINUE;
    END IF;
    expr := CASE r.proname
      WHEN 'apply_feed_stock_count' THEN '_count_id::text'
      WHEN 'approve_feed_batch_cost' THEN 'p_batch::text'
      WHEN 'approve_feed_production_invoice' THEN 'p_invoice_id::text'
      WHEN 'approve_feed_sales_return' THEN 'p_return_id::text'
      WHEN 'cancel_feed_sales_return' THEN 'p_return_id::text'
      WHEN 'edit_approved_feed_production_invoice' THEN 'p_invoice_id::text'
      WHEN 'feed_batch_cancel' THEN 'p_batch_id::text'
      WHEN 'finalize_meat_production' THEN '_invoice_id::text'
      WHEN 'meat_factory_adjust_stock' THEN 'p_item_id::text'
      WHEN 'meat_production_transfer_to_main' THEN 'COALESCE(_invoice_id, _product_id)::text'
      WHEN 'reject_meat_production_transfer' THEN '_transfer_id::text'
      ELSE 'COALESCE(NEW.id, OLD.id)::text'
    END;
    pos := strpos(def, 'BEGIN');
    IF pos = 0 THEN
      RAISE EXCEPTION 'closed loop: no BEGIN in %', r.proname;
    END IF;
    def := substr(def, 1, pos + 4)
      || format(
           E'\n  PERFORM set_config(''app.named_stock_source_type'', %L, true);\n  PERFORM set_config(''app.named_stock_source_id'', %s, true);\n  PERFORM set_config(''app.named_stock_reason'', %L, true);\n',
           'fn:' || r.proname, expr, 'ترحيل ' || r.proname
         )
      || substr(def, pos + 5);

    n := 0;
    LOOP
      changed := false;
      IF def ~ 'UPDATE[[:space:]]+(public\.)?feed_raw_materials[[:space:]]+[a-zA-Z_]*[[:space:]]*SET[[:space:]]+stock([^_[:alnum:]])' THEN
        n := n + 1;
        def := regexp_replace(
          def,
          '(UPDATE[[:space:]]+(?:public\.)?feed_raw_materials[[:space:]]+[a-zA-Z_]*[[:space:]]*)SET[[:space:]]+stock([^_[:alnum:]])',
          format('PERFORM set_config(''app.named_stock_source_line'', %L, true); PERFORM set_config(''app.named_stock_armed'', ''on'', true); \1SET /*named*/ stock\2', 's' || n),
          'i'
        );
        changed := true;
      ELSIF def ~ 'UPDATE[[:space:]]+(public\.)?feed_products[[:space:]]+[a-zA-Z_]*[[:space:]]*SET[[:space:]]+current_stock([^_[:alnum:]])' THEN
        n := n + 1;
        def := regexp_replace(
          def,
          '(UPDATE[[:space:]]+(?:public\.)?feed_products[[:space:]]+[a-zA-Z_]*[[:space:]]*)SET[[:space:]]+current_stock([^_[:alnum:]])',
          format('PERFORM set_config(''app.named_stock_source_line'', %L, true); PERFORM set_config(''app.named_stock_armed'', ''on'', true); \1SET /*named*/ current_stock\2', 's' || n),
          'i'
        );
        changed := true;
      ELSIF def ~ 'UPDATE[[:space:]]+(public\.)?slaughterhouse_feed_inventory[[:space:]]+[a-zA-Z_]*[[:space:]]*SET[[:space:]]+current_kg([^_[:alnum:]])' THEN
        n := n + 1;
        def := regexp_replace(
          def,
          '(UPDATE[[:space:]]+(?:public\.)?slaughterhouse_feed_inventory[[:space:]]+[a-zA-Z_]*[[:space:]]*)SET[[:space:]]+current_kg([^_[:alnum:]])',
          format('PERFORM set_config(''app.named_stock_source_line'', %L, true); PERFORM set_config(''app.named_stock_armed'', ''on'', true); \1SET /*named*/ current_kg\2', 's' || n),
          'i'
        );
        changed := true;
      ELSIF def ~ 'UPDATE[[:space:]]+(public\.)?brooding_feed_inventory[[:space:]]+[a-zA-Z_]*[[:space:]]*SET[[:space:]]+current_kg([^_[:alnum:]])' THEN
        n := n + 1;
        def := regexp_replace(
          def,
          '(UPDATE[[:space:]]+(?:public\.)?brooding_feed_inventory[[:space:]]+[a-zA-Z_]*[[:space:]]*)SET[[:space:]]+current_kg([^_[:alnum:]])',
          format('PERFORM set_config(''app.named_stock_source_line'', %L, true); PERFORM set_config(''app.named_stock_armed'', ''on'', true); \1SET /*named*/ current_kg\2', 's' || n),
          'i'
        );
        changed := true;
      ELSIF def ~ 'UPDATE[[:space:]]+(public\.)?meat_factory_products[[:space:]]+[a-zA-Z_]*[[:space:]]*SET[[:space:]]+current_stock([^_[:alnum:]])' THEN
        n := n + 1;
        def := regexp_replace(
          def,
          '(UPDATE[[:space:]]+(?:public\.)?meat_factory_products[[:space:]]+[a-zA-Z_]*[[:space:]]*)SET[[:space:]]+current_stock([^_[:alnum:]])',
          format('PERFORM set_config(''app.named_stock_source_line'', %L, true); PERFORM set_config(''app.named_stock_armed'', ''on'', true); \1SET /*named*/ current_stock\2', 's' || n),
          'i'
        );
        changed := true;
      END IF;
      EXIT WHEN NOT changed;
    END LOOP;

    IF n = 0 THEN
      IF r.def ~* '(feed_raw_materials|feed_products|slaughterhouse_feed_inventory|brooding_feed_inventory|meat_factory_products)'
         AND r.def ~* 'SET[[:space:]]+(stock|current_stock|current_kg)' THEN
        RAISE EXCEPTION 'closed loop: % has a stock update the armer missed', r.proname;
      END IF;
      CONTINUE;
    END IF;
    IF right(btrim(def), 1) <> ';' THEN
      def := def || ';';
    END IF;
    EXECUTE def;
    marked := n;
  END LOOP;
END
$inj$;

-- ---------------------------------------------------------------------------
-- Stale quantity columns. History stays readable. Active September flows do
-- not write these. Functions that still assign them now fail and are listed
-- by closed_loop_stale_writers().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_stale_stock_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    v_before := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.stock END;
    v_after := NEW.stock;
  ELSE
    v_before := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.stock END;
    v_after := NEW.stock;
  END IF;
  IF v_before IS NOT DISTINCT FROM v_after THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND COALESCE(v_after, 0) = 0 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'STALE_STORE_READONLY: % لم يعد مخزنًا حيًا. الرصيد في دفتر المخزن أو خامات المصنع. البيانات تبقى للقراءة.', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_stale_products_stock ON public.products;
CREATE TRIGGER trg_00_stale_products_stock
  BEFORE INSERT OR UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.reject_stale_stock_write();

DROP TRIGGER IF EXISTS trg_00_stale_meat_raw ON public.meat_raw_inventory;
CREATE TRIGGER trg_00_stale_meat_raw
  BEFORE INSERT OR UPDATE OF stock ON public.meat_raw_inventory
  FOR EACH ROW EXECUTE FUNCTION public.reject_stale_stock_write();

DROP TRIGGER IF EXISTS trg_00_stale_meat_finished ON public.meat_finished_inventory;
CREATE TRIGGER trg_00_stale_meat_finished
  BEFORE INSERT OR UPDATE OF stock ON public.meat_finished_inventory
  FOR EACH ROW EXECUTE FUNCTION public.reject_stale_stock_write();

DROP TRIGGER IF EXISTS trg_00_stale_meat_packaging ON public.meat_packaging_inventory;
CREATE TRIGGER trg_00_stale_meat_packaging
  BEFORE INSERT OR UPDATE OF stock ON public.meat_packaging_inventory
  FOR EACH ROW EXECUTE FUNCTION public.reject_stale_stock_write();

DROP TRIGGER IF EXISTS trg_00_stale_mf_raw_materials ON public.meat_factory_raw_materials;
CREATE TRIGGER trg_00_stale_mf_raw_materials
  BEFORE INSERT OR UPDATE OF stock ON public.meat_factory_raw_materials
  FOR EACH ROW EXECUTE FUNCTION public.reject_stale_stock_write();

DROP TRIGGER IF EXISTS trg_00_stale_packaging_materials ON public.packaging_materials;
CREATE TRIGGER trg_00_stale_packaging_materials
  BEFORE INSERT OR UPDATE OF stock ON public.packaging_materials
  FOR EACH ROW EXECUTE FUNCTION public.reject_stale_stock_write();

REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.meat_raw_inventory,
  public.meat_finished_inventory,
  public.meat_packaging_inventory,
  public.meat_factory_raw_materials,
  public.packaging_materials
FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.closed_loop_stale_writers()
RETURNS TABLE(function_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.proname::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname <> 'reject_stale_stock_write'
     AND (
       p.prosrc ~* 'UPDATE[[:space:]]+(public\.)?(products|meat_raw_inventory|meat_finished_inventory|meat_packaging_inventory|meat_factory_raw_materials|packaging_materials)[[:space:]]+SET[[:space:]]+stock'
       OR p.prosrc ~* 'NEW\.stock[[:space:]]*:='
     )
   ORDER BY 1
$$;

REVOKE ALL ON FUNCTION public.closed_loop_stale_writers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.closed_loop_stale_writers() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- stock_status becomes dispatched only after a ledger posting.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_premature_dispatched()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stock_status IS DISTINCT FROM 'dispatched' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.stock_status = 'dispatched' THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.order_stock_posted', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements m
     WHERE m.source_type = 'order_delivery'
       AND m.source_id = NEW.id
       AND COALESCE(m.approval_status, 'posted') = 'posted'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi
     WHERE oi.order_id = NEW.id
       AND COALESCE(oi.quantity, 0) > 0
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'STOCK_NOT_POSTED: لا يُعلَّم الأوردر مصروفاً قبل نجاح ترحيل الدفتر. سبب الفشل يظهر في شاشة المطابقة وبنود الخصم.';
END;
$$;

DROP TRIGGER IF EXISTS trg_00_reject_premature_dispatched ON public.orders;
CREATE TRIGGER trg_00_reject_premature_dispatched
  BEFORE INSERT OR UPDATE OF stock_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.reject_premature_dispatched();

DO $dispatch$
DECLARE
  def text;
  old text := 'UPDATE public.orders SET stock_status = ''dispatched'' WHERE id = p_order_id;';
  neu text := 'PERFORM set_config(''app.order_stock_posted'', ''on'', true); UPDATE public.orders SET stock_status = ''dispatched'' WHERE id = p_order_id; PERFORM set_config(''app.order_stock_posted'', ''off'', true);';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_dispatch_order_stock_core'
   ORDER BY p.oid DESC
   LIMIT 1;
  IF def IS NULL OR strpos(def, old) = 0 THEN
    RAISE EXCEPTION 'closed loop: dispatch stock_status anchor missing';
  END IF;
  def := replace(def, old, neu);
  IF right(btrim(def), 1) <> ';' THEN def := def || ';'; END IF;
  EXECUTE def;
END
$dispatch$;

-- ---------------------------------------------------------------------------
-- Slaughter output -> canonical product card. Unmapped names are blocked.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.slaughter_output_product_map (
  cut_name_norm text PRIMARY KEY,
  cut_name_sample text NOT NULL,
  product_id uuid REFERENCES public.products(id),
  seeded boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.slaughter_output_product_map (cut_name_norm, cut_name_sample, product_id, seeded)
SELECT c.norm, c.sample, (array_agg(p.id ORDER BY p.is_active DESC NULLS LAST, p.created_at))[1], true
  FROM (
    SELECT public.normalize_ar_name(o.cut_name_ar) AS norm,
           min(o.cut_name_ar) AS sample
      FROM public.slaughter_batch_outputs o
     WHERE o.cut_name_ar IS NOT NULL AND btrim(o.cut_name_ar) <> ''
     GROUP BY 1
  ) c
  JOIN public.products p ON public.normalize_ar_name(p.name) = c.norm
 GROUP BY c.norm, c.sample
HAVING count(DISTINCT p.id) = 1
ON CONFLICT (cut_name_norm) DO NOTHING;

CREATE OR REPLACE FUNCTION public.list_unmapped_slaughter_outputs()
RETURNS TABLE(cut_name_ar text, occurrences bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.cut_name_ar, count(*)::bigint
    FROM public.slaughter_batch_outputs o
   WHERE o.received_status IS DISTINCT FROM 'received'
     AND o.received_status IS DISTINCT FROM 'received_previously'
     AND o.product_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.slaughter_output_product_map m
        WHERE m.cut_name_norm = public.normalize_ar_name(o.cut_name_ar)
          AND m.product_id IS NOT NULL
     )
   GROUP BY o.cut_name_ar
   ORDER BY count(*) DESC, o.cut_name_ar
$$;

REVOKE ALL ON FUNCTION public.list_unmapped_slaughter_outputs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_unmapped_slaughter_outputs() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.receive_slaughter_output(p_output_id uuid, p_warehouse_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out public.slaughter_batch_outputs%ROWTYPE;
  v_item_id uuid;
  v_product uuid;
  v_uid uuid := auth.uid();
  v_batch_no text;
  v_added boolean := false;
  v_posted jsonb;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role,
    'slaughterhouse_manager'::app_role,
    'meat_factory_manager'::app_role,
    'production_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك باستلام مخرجات المجزر';
  END IF;

  SELECT * INTO v_out FROM public.slaughter_batch_outputs WHERE id = p_output_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTPUT_NOT_FOUND'; END IF;
  IF v_out.received_status = 'received_previously' THEN
    RAISE EXCEPTION 'ALREADY_RECEIVED: هذا المخرج مورّد سابقًا ولا يُستلم مرة ثانية';
  END IF;
  IF v_out.received_status = 'received' AND v_out.received_inventory_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_RECEIVED: تم استلام هذا المخرج مسبقا';
  END IF;

  IF v_out.destination = 'meat_factory' THEN
    v_posted := public.receive_slaughter_output_to_meat_factory(p_output_id);
    RETURN v_posted || jsonb_build_object('path', 'meat_factory_raw');
  END IF;

  IF v_out.destination NOT IN ('warehouse', 'branch') THEN
    RAISE EXCEPTION 'INVALID_DESTINATION: المخرج ليس موجها للمخزن';
  END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED: يجب اختيار المخزن'; END IF;

  SELECT batch_number INTO v_batch_no FROM public.slaughter_batches WHERE id = v_out.batch_id;

  IF v_out.quality_status = 'accepted' AND COALESCE(v_out.actual_weight_kg, 0) > 0 THEN
    v_product := v_out.product_id;
    IF v_product IS NULL THEN
      SELECT m.product_id INTO v_product
        FROM public.slaughter_output_product_map m
       WHERE m.cut_name_norm = public.normalize_ar_name(v_out.cut_name_ar)
         AND m.product_id IS NOT NULL;
    END IF;
    IF v_product IS NULL THEN
      RAISE EXCEPTION 'UNMAPPED_SLAUGHTER_OUTPUT: لا توجد خريطة من «%» إلى منتج. الاستلام متوقف ولن تُفتح بطاقة يتيمة.', v_out.cut_name_ar;
    END IF;

    SELECT i.id INTO v_item_id
      FROM public.inventory_items i
     WHERE i.warehouse_id = p_warehouse_id
       AND i.product_id = v_product
       AND COALESCE(i.is_active, true)
     ORDER BY i.created_at
     LIMIT 1;

    IF v_item_id IS NULL THEN
      INSERT INTO public.inventory_items (warehouse_id, product_id, name, category, unit, stock, low_stock_threshold, module)
      SELECT p_warehouse_id, v_product, p.name, 'لحوم', 'كجم', 0, 5, 'slaughter'
        FROM public.products p WHERE p.id = v_product
      RETURNING id INTO v_item_id;
    END IF;

    PERFORM set_config('app.inventory_internal_post', 'on', true);
    v_posted := public.post_inventory_movement(
      v_item_id, 'in', v_out.actual_weight_kg, 'manual_in', v_out.id, '1',
      'استلام مجزر',
      'استلام صنف ' || v_out.cut_name_ar || ' من دفعة ' || COALESCE(v_batch_no, ''),
      now(), COALESCE(v_out.unit_cost, 0), 'المجزر',
      'استلام من دفعة ذبح ' || COALESCE(v_batch_no, ''),
      'delta', false, p_warehouse_id, v_product, 'slaughter',
      NULL, NULL, 'slaughter_output', v_out.id::text, NULL, NULL, NULL, NULL
    );
    PERFORM set_config('app.inventory_internal_post', 'off', true);
    v_added := COALESCE(v_posted->>'status', '') IN ('posted', 'already_posted');
  END IF;

  UPDATE public.slaughter_batch_outputs
     SET received_status = 'received',
         received_at = COALESCE(received_at, now()),
         received_by = COALESCE(received_by, v_uid),
         received_warehouse_id = p_warehouse_id,
         received_inventory_item_id = v_item_id,
         product_id = COALESCE(product_id, v_product)
   WHERE id = p_output_id;

  INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES ('warehouse_receipt', 'output', p_output_id, v_out.batch_id, v_uid,
          jsonb_build_object('warehouse_id', p_warehouse_id, 'item_id', v_item_id, 'product_id', v_product, 'qty', v_out.actual_weight_kg, 'added_to_stock', v_added),
          'استلام مخرج المجزر على بطاقة المنتج');

  RETURN jsonb_build_object('success', true, 'added_to_stock', v_added, 'item_id', v_item_id, 'product_id', v_product, 'post', v_posted);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_unreceived_slaughter_outputs()
RETURNS TABLE(
  output_id uuid,
  batch_id uuid,
  batch_number text,
  cut_name_ar text,
  destination text,
  actual_weight_kg numeric,
  received_status text,
  age_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.id, o.batch_id, b.batch_number, o.cut_name_ar, o.destination,
         o.actual_weight_kg, o.received_status,
         EXTRACT(day FROM now() - COALESCE(b.slaughter_date::timestamptz, o.created_at))::integer
    FROM public.slaughter_batch_outputs o
    JOIN public.slaughter_batches b ON b.id = o.batch_id
   WHERE o.received_status IS DISTINCT FROM 'received'
     AND o.received_status IS DISTINCT FROM 'received_previously'
     AND o.destination IN ('warehouse', 'branch', 'meat_factory')
   ORDER BY o.created_at
$$;

REVOKE ALL ON FUNCTION public.list_unreceived_slaughter_outputs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_unreceived_slaughter_outputs() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Meat production receipt: ledger post, no new nameless card.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_meat_production_transfer(_transfer_id uuid, _received_qty numeric DEFAULT NULL::numeric, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t record;
  v_inv_item uuid;
  v_product_name text;
  v_linked uuid;
  v_product uuid;
  v_final_qty numeric;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager')
    OR public.has_role(v_uid, 'executive_manager')
    OR public.has_role(v_uid, 'warehouse_supervisor')
    OR public.has_role(v_uid, 'warehouse_manager')
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية اعتماد الوارد';
  END IF;

  SELECT * INTO t FROM meat_production_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF t.status <> 'pending' THEN
    RAISE EXCEPTION 'التحويل ليس بانتظار الاعتماد (الحالة: %)', t.status;
  END IF;

  v_final_qty := COALESCE(_received_qty, t.quantity);
  IF v_final_qty <= 0 THEN RAISE EXCEPTION 'الكمية المستلمة يجب أن تكون أكبر من صفر'; END IF;
  IF v_final_qty > t.quantity THEN
    RAISE EXCEPTION 'الكمية المستلمة (%) أكبر من الكمية المحوّلة (%)', v_final_qty, t.quantity;
  END IF;

  IF v_final_qty < t.quantity THEN
    PERFORM set_config('app.named_stock_internal', 'on', true);
    PERFORM public.post_named_stock(
      'meat_factory_products', t.product_id, (t.quantity - v_final_qty),
      'meat_production_shortage', t.id, 'return',
      'إرجاع فرق الاستلام لمخزن المصنع', NULL, 'delta', NULL
    );
    PERFORM set_config('app.named_stock_internal', 'off', true);
  END IF;

  SELECT name_ar, inventory_item_id INTO v_product_name, v_linked
    FROM meat_factory_products WHERE id = t.product_id;
  IF v_linked IS NOT NULL THEN
    SELECT product_id INTO v_product FROM inventory_items WHERE id = v_linked;
  END IF;

  IF v_product IS NOT NULL THEN
    SELECT id INTO v_inv_item
      FROM inventory_items
     WHERE warehouse_id = t.destination_warehouse_id
       AND product_id = v_product
       AND COALESCE(is_active, true)
     ORDER BY created_at
     LIMIT 1;
    IF v_inv_item IS NULL THEN
      INSERT INTO inventory_items (warehouse_id, product_id, name, unit, stock, module)
      VALUES (t.destination_warehouse_id, v_product, v_product_name, 'كجم', 0, 'meat_factory')
      RETURNING id INTO v_inv_item;
    END IF;
  ELSE
    SELECT id INTO v_inv_item FROM inventory_items
     WHERE warehouse_id = t.destination_warehouse_id AND name = v_product_name AND COALESCE(is_active, true)
     LIMIT 1;
    IF v_inv_item IS NULL THEN
      RAISE EXCEPTION 'CANONICAL_CARD_REQUIRED: لا توجد بطاقة مربوطة في مخزن الوجهة للصنف «%». لن تُفتح بطاقة يتيمة.', v_product_name;
    END IF;
  END IF;

  PERFORM set_config('app.inventory_internal_post', 'on', true);
  PERFORM public.post_inventory_movement(
    v_inv_item, 'in', v_final_qty, 'production', t.id, 'receive',
    'وارد معتمد من مصنع اللحوم', COALESCE(_notes, t.notes), now(), t.unit_cost,
    'مصنع اللحوم', 'وارد معتمد من مصنع اللحوم', 'delta', false,
    t.destination_warehouse_id, v_product, 'meat_factory', NULL, NULL,
    'meat_production_transfer', t.id::text, t.destination_warehouse_id, NULL, NULL, NULL
  );
  PERFORM set_config('app.inventory_internal_post', 'off', true);

  UPDATE meat_production_transfers
    SET status = 'received',
        received_at = now(),
        received_by = v_uid,
        quantity = v_final_qty,
        total_cost = v_final_qty * unit_cost,
        notes = COALESCE(_notes, notes)
    WHERE id = t.id;

  RETURN t.id;
END $function$;

-- receive_mf_transfer already posts with source (transfer id, line id).
-- Assert that and keep the receipt step.

-- ---------------------------------------------------------------------------
-- Manufacturing stays in the factory warehouse. Cancel references the original.
-- Slaughter reversal references the original receipt.
-- Manager reconcile: feed through the named ledger; stale stores rejected.
-- ---------------------------------------------------------------------------
DO $rewrite$
DECLARE
  def text;
  start_at int;
  stop_at int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'approve_meat_manufacturing_invoice'
   ORDER BY p.oid DESC LIMIT 1;

  IF strpos(def, 'لا يمكن اعتماد فاتورة بحالة %') = 0 THEN
    RAISE EXCEPTION 'closed loop: approve anchor missing';
  END IF;
  def := replace(def, 'PERFORM set_config(''app.inventory_ledger_posted'', ''on'', true);', '');
  def := replace(def, 'PERFORM set_config(''app.inventory_bridge_insert'', ''on'', true);', '');
  def := replace(
    def,
    E'IF v_inv.status IN (''rejected'',''cancelled'') THEN\n    RAISE EXCEPTION ''لا يمكن اعتماد فاتورة بحالة %'', v_inv.status;\n  END IF;',
    E'IF v_inv.status IN (''rejected'',''cancelled'') THEN\n    RAISE EXCEPTION ''لا يمكن اعتماد فاتورة بحالة %'', v_inv.status;\n  END IF;\n\n  IF v_inv.factory_warehouse_id IS NULL\n     OR v_inv.factory_warehouse_id = ''5ec781b5-685b-4806-b59a-83a79ea5662c''::uuid\n     OR EXISTS (\n       SELECT 1 FROM public.warehouses w\n        WHERE w.id = v_inv.factory_warehouse_id AND w.name ILIKE ''%الرئيسي%''\n     ) THEN\n    RAISE EXCEPTION ''MANUFACTURING_STAYS_IN_FACTORY: اعتماد التصنيع لا يكتب مخزون المخزن الرئيسي. انقل التام بتحويل ثم استلام.'';\n  END IF;'
  );
  IF strpos(def, 'INSERT INTO public.inventory_movements(') = 0 THEN
    RAISE EXCEPTION 'closed loop: approve still expected a finished-goods insert';
  END IF;
  start_at := strpos(def, 'IF NOT EXISTS (');
  stop_at := strpos(def, 'UPDATE public.meat_manufacturing_invoices');
  IF start_at = 0 OR stop_at = 0 OR stop_at < start_at THEN
    RAISE EXCEPTION 'closed loop: approve finished block not found';
  END IF;
  def := substr(def, 1, start_at - 1)
    || $block$IF NOT EXISTS (
    SELECT 1 FROM public.inventory_movements
     WHERE (
       (source_type = 'production' AND source_id = p_invoice_id AND source_line_id = 'finished')
       OR (reference = v_inv.invoice_no AND item_id = v_finished_item_id AND movement_type = 'in')
     )
       AND COALESCE(approval_status, 'posted') = 'posted'
       AND source_type IS DISTINCT FROM 'reversal'
  ) THEN
    PERFORM set_config('app.inventory_internal_post', 'on', true);
    PERFORM public.post_inventory_movement(
      v_finished_item_id, 'in', v_inv.finished_qty, 'production',
      p_invoice_id, 'finished',
      'إنتاج تام',
      'إنتاج تام من فاتورة تصنيع ' || v_inv.invoice_no,
      now(), ROUND(v_total / NULLIF(v_inv.finished_qty, 0), 3),
      'مصنع اللحوم', v_inv.invoice_no, 'delta', false,
      v_inv.factory_warehouse_id, NULL, 'meat', NULL, NULL,
      'meat_manufacturing_invoices', p_invoice_id::text, NULL, NULL, NULL, NULL
    );
    PERFORM set_config('app.inventory_internal_post', 'off', true);
  ELSE
    v_finished_existed := true;
  END IF;

  $block$
    || substr(def, stop_at);
  IF right(btrim(def), 1) <> ';' THEN def := def || ';'; END IF;
  EXECUTE def;

  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cancel_meat_manufacturing_invoice'
   ORDER BY p.oid DESC LIMIT 1;
  IF strpos(def, 'v_before jsonb;') = 0 THEN
    RAISE EXCEPTION 'closed loop: cancel declare anchor missing';
  END IF;
  def := replace(def, 'v_before jsonb;', 'v_before jsonb; v_orig uuid;');
  start_at := strpos(def, 'IF v_inv.finished_item_id IS NOT NULL AND v_fin_reverse_qty > 0 THEN');
  stop_at := strpos(def, '-- 2d) Revert carryover_out');
  IF start_at = 0 OR stop_at = 0 THEN
    RAISE EXCEPTION 'closed loop: cancel finished block not found';
  END IF;
  def := substr(def, 1, start_at - 1)
    || $block$IF v_inv.finished_item_id IS NOT NULL AND v_fin_reverse_qty > 0 THEN
    SELECT mv.id INTO v_orig
      FROM public.inventory_movements mv
     WHERE mv.item_id = v_inv.finished_item_id
       AND COALESCE(mv.approval_status, 'posted') = 'posted'
       AND mv.source_type IS DISTINCT FROM 'reversal'
       AND (
         (mv.source_type = 'production' AND mv.source_id = p_invoice_id AND mv.source_line_id = 'finished')
         OR (mv.reference = v_inv.invoice_no AND mv.movement_type = 'in')
       )
     ORDER BY mv.performed_at
     LIMIT 1;

    PERFORM set_config('app.inventory_internal_post', 'on', true);
    IF v_orig IS NOT NULL
       AND NOT v_partial
       AND EXISTS (
         SELECT 1 FROM public.inventory_movements
          WHERE id = v_orig AND stock_before IS NOT NULL AND stock_after IS NOT NULL
       ) THEN
      PERFORM public.reverse_posted_inventory_movement(v_orig, p_reason);
    ELSE
      PERFORM public.post_inventory_movement(
        v_inv.finished_item_id, 'out', v_fin_reverse_qty, 'reversal',
        COALESCE(v_orig, p_invoice_id), 'cancel-finished', p_reason,
        'REVERSAL إلغاء فاتورة تصنيع ' || v_inv.invoice_no
          || CASE WHEN v_partial THEN ' (إلغاء جزئي بصلاحية المدير)' ELSE '' END,
        now(), COALESCE(v_inv.unit_cost, 0), 'مصنع اللحوم', v_inv.invoice_no || '-REV',
        'delta', false, v_inv.factory_warehouse_id, NULL, 'meat', v_orig, NULL,
        'production', p_invoice_id::text, NULL, NULL, NULL, NULL
      );
    END IF;
    PERFORM set_config('app.inventory_internal_post', 'off', true);
  END IF;

  $block$
    || substr(def, stop_at);
  IF right(btrim(def), 1) <> ';' THEN def := def || ';'; END IF;
  EXECUTE def;

  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reverse_receipt_approval'
   ORDER BY p.oid DESC LIMIT 1;
  start_at := strpos(def, 'ELSIF p_kind = ''slaughter'' THEN');
  stop_at := strpos(def, 'ELSE');
  -- The slaughter branch ends at the kind ELSE. Take the last ELSE before END of the IF p_kind.
  stop_at := strpos(def, E'  ELSE\n    RAISE EXCEPTION ''unknown_kind');
  IF start_at = 0 OR stop_at = 0 THEN
    RAISE EXCEPTION 'closed loop: slaughter reversal branch not found';
  END IF;
  def := substr(def, 1, start_at - 1)
    || $block$ELSIF p_kind = 'slaughter' THEN
    SELECT batch_number INTO v_ref_no FROM public.slaughter_batches WHERE id = p_ref_id;
    PERFORM set_config('app.inventory_internal_post', 'on', true);
    FOR o IN
      SELECT * FROM public.slaughter_batch_outputs
       WHERE batch_id = p_ref_id AND received_status = 'received'
      FOR UPDATE
    LOOP
      m := NULL;
      SELECT mv.* INTO m
        FROM public.inventory_movements mv
       WHERE COALESCE(mv.approval_status, 'posted') = 'posted'
         AND mv.source_type IS DISTINCT FROM 'reversal'
         AND NOT EXISTS (
           SELECT 1 FROM public.inventory_movements r
            WHERE r.source_type = 'reversal' AND r.source_id = mv.id
              AND COALESCE(r.approval_status, 'posted') = 'posted'
         )
         AND (
           (mv.source_id = o.id AND mv.source_line_id = '1')
           OR (mv.reference_type = 'slaughter_output' AND mv.reference_id = o.id::text)
           OR (
             o.received_inventory_item_id IS NOT NULL
             AND mv.item_id = o.received_inventory_item_id
             AND mv.movement_type = 'in'
             AND mv.quantity = o.actual_weight_kg
             AND COALESCE(mv.notes, '') LIKE '%' || o.cut_name_ar || '%'
           )
         )
       ORDER BY mv.performed_at DESC
       LIMIT 1;

      IF m.id IS NOT NULL AND m.stock_before IS NOT NULL AND m.stock_after IS NOT NULL THEN
        PERFORM public.reverse_posted_inventory_movement(m.id, p_reason);
      ELSIF o.received_inventory_item_id IS NOT NULL AND COALESCE(o.actual_weight_kg, 0) > 0 THEN
        PERFORM public.post_inventory_movement(
          o.received_inventory_item_id, 'out', o.actual_weight_kg,
          'reversal', COALESCE(m.id, o.id), '1', p_reason,
          'عكس استلام دفعة ذبح ' || COALESCE(v_ref_no, ''),
          now(), COALESCE(o.unit_cost, 0), 'المجزر',
          'عكس استلام دفعة ذبح ' || COALESCE(v_ref_no, ''),
          'delta', true, o.received_warehouse_id, NULL, 'slaughter',
          m.id, NULL, 'slaughter_output', o.id::text, NULL, NULL, NULL, NULL
        );
      END IF;
      UPDATE public.slaughter_batch_outputs
         SET received_status = 'received_previously',
             received_at = NULL,
             notes = COALESCE(notes,'') || E'\n[عُكس اعتماد الاستلام واعتُبرت موردة سابقًا: ' || p_reason || ']'
       WHERE id = o.id;
      v_reversed := v_reversed + 1;
    END LOOP;
    PERFORM set_config('app.inventory_internal_post', 'off', true);
  $block$
    || substr(def, stop_at);
  IF right(btrim(def), 1) <> ';' THEN def := def || ';'; END IF;
  EXECUTE def;
END
$rewrite$;

CREATE OR REPLACE FUNCTION public.mr_reconcile_negative_stock(
  p_task_id uuid, p_target_table text, p_target_id text, p_new_stock numeric, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_old numeric; v_task public.data_quality_tasks%ROWTYPE; v_admin boolean; v_feed uuid;
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
    IF v_task.module <> 'warehouse' THEN RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_TARGET'; END IF;
    IF p_target_table <> 'inventory_items' THEN RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_TARGET'; END IF;
  END IF;

  IF p_target_table NOT IN ('meat_factory_raw_materials','feed_raw_materials','inventory_items','products') THEN
    RAISE EXCEPTION 'INVALID_TARGET';
  END IF;

  IF p_target_table IN ('meat_factory_raw_materials', 'products') THEN
    RAISE EXCEPTION 'STALE_STORE_READONLY: % للقراءة فقط. سوِّ الرصيد في دفتر المخزن الحي.', p_target_table;
  ELSIF p_target_table='feed_raw_materials' THEN
    BEGIN
      v_feed := p_target_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      SELECT id INTO v_feed FROM public.feed_raw_materials WHERE item_code = p_target_id;
    END;
    IF v_feed IS NULL THEN
      RAISE EXCEPTION 'INVALID_TARGET';
    END IF;
    SELECT stock INTO v_old FROM public.feed_raw_materials WHERE id = v_feed FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    PERFORM set_config('app.named_stock_internal', 'on', true);
    PERFORM public.post_named_stock(
      'feed_raw_materials', v_feed, 0, 'manager_reconcile', p_task_id, 'set',
      p_reason, NULL, 'set', p_new_stock
    );
    PERFORM set_config('app.named_stock_internal', 'off', true);
  ELSIF p_target_table='inventory_items' THEN
    SELECT stock INTO v_old FROM public.inventory_items WHERE id=p_target_id::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    PERFORM set_config('app.inventory_internal_post', 'on', true);
    PERFORM public.post_inventory_movement(
      p_target_id::uuid, 'adjustment', p_new_stock, 'manual_adjustment',
      p_task_id, 'reconcile', p_reason, p_reason, now(), NULL, 'Manager Review',
      'تسوية مراجعة مدير', 'set', true, NULL, NULL, 'warehouse', NULL, NULL,
      'manual_adjustment', p_target_id, NULL, NULL, NULL, NULL
    );
    PERFORM set_config('app.inventory_internal_post', 'off', true);
  END IF;

  UPDATE public.data_quality_tasks SET status='resolved', resolved_by=auth.uid(), resolved_at=now(), resolution_notes=p_reason
    WHERE id=p_task_id;

  INSERT INTO public.manager_review_audit(task_id, action, module, target_table, target_id, old_value, new_value, reason, performed_by)
  VALUES (p_task_id, 'reconcile_stock', v_task.module, p_target_table, p_target_id,
          jsonb_build_object('stock', v_old), jsonb_build_object('stock', p_new_stock), p_reason, auth.uid());

  RETURN jsonb_build_object('success', true, 'old', v_old, 'new', p_new_stock);
END
$function$;

-- Courier return uses the same order_return key as cancel, so the two paths
-- cannot both add the quantity.
DO $courier$
DECLARE
  def text;
  start_at int;
  stop_at int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_courier_return'
   ORDER BY p.oid DESC LIMIT 1;
  def := replace(def, 'PERFORM set_config(''app.inventory_bridge_insert'', ''on'', true);', '');
  def := replace(def, 'PERFORM set_config(''app.inventory_ledger_posted'', ''on'', true);', '');
  start_at := strpos(def, 'INSERT INTO public.inventory_movements(');
  stop_at := strpos(def, 'RETURNING id INTO v_mov_id;');
  IF start_at = 0 OR stop_at = 0 THEN
    RAISE EXCEPTION 'closed loop: courier return insert not found';
  END IF;
  stop_at := stop_at + length('RETURNING id INTO v_mov_id;');
  def := substr(def, 1, start_at - 1)
    || $block$PERFORM set_config('app.inventory_internal_post', 'on', true);
    v_mov_id := (public.post_inventory_movement(
      v_line.inventory_item_id, 'sales_return', v_line.quantity,
      'order_return', v_order.id, v_line.inventory_item_id::text,
      COALESCE(NULLIF(p_reason,''), 'مرتجع كامل من العميل'),
      trim(coalesce(v_order.order_number,'') || ' — مرتجع مندوب'),
      now(), 0, 'مرتجع من المندوب — ' || COALESCE(v_courier, ''), v_reference,
      'delta', false,
      NULL, NULL, 'courier_distribution', NULL, NULL,
      'courier_return', p_assignment_id::text, NULL, NULL, NULL, NULL
    )->>'id')::uuid;
    PERFORM set_config('app.inventory_internal_post', 'off', true);
    $block$
    || substr(def, stop_at);
  IF right(btrim(def), 1) <> ';' THEN def := def || ';'; END IF;
  EXECUTE def;
END
$courier$;

-- ---------------------------------------------------------------------------
-- Reports: production not yet in main, slaughter not yet received.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_untransferred_production()
RETURNS TABLE(
  bucket text,
  doc_id uuid,
  doc_no text,
  product_name text,
  qty numeric,
  status text,
  approved_at timestamptz,
  age_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 'not_sent'::text, i.id, i.invoice_no, i.product_name, i.finished_qty, i.status, i.approved_at,
         EXTRACT(day FROM now() - COALESCE(i.approved_at, i.created_at))::integer
    FROM public.meat_manufacturing_invoices i
   WHERE i.status = 'approved'
     AND i.transfer_id IS NULL
  UNION ALL
  SELECT 'sent_not_received'::text, t.id, t.transfer_no, p.name_ar, t.quantity, t.status, t.created_at,
         EXTRACT(day FROM now() - t.created_at)::integer
    FROM public.meat_production_transfers t
    LEFT JOIN public.meat_factory_products p ON p.id = t.product_id
   WHERE t.status = 'pending'
  UNION ALL
  SELECT 'sent_not_received'::text, f.id, f.transfer_no, 'تحويل تام قديم', NULL, f.status, f.created_at,
         EXTRACT(day FROM now() - f.created_at)::integer
    FROM public.mf_transfers f
   WHERE f.status = 'awaiting_receipt'
  ORDER BY 7 NULLS LAST
$$;

REVOKE ALL ON FUNCTION public.list_untransferred_production() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_untransferred_production() TO authenticated, service_role;

-- Reconciliation keeps the Sep 30 baseline and adds one check per named store.
ALTER FUNCTION public.inventory_reconciliation_check(integer)
  RENAME TO inventory_reconciliation_check_core;

CREATE OR REPLACE FUNCTION public.inventory_reconciliation_check(p_in_transit_days integer DEFAULT 3)
RETURNS TABLE(
  check_code text,
  warehouse_id uuid,
  item_id uuid,
  source_ref text,
  detail text,
  expected_qty numeric,
  actual_qty numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY SELECT * FROM public.inventory_reconciliation_check_core(p_in_transit_days);

  RETURN QUERY
  SELECT 'named_stock_mismatch'::text, NULL::uuid, s.item_id, s.store_name,
         'رصيد المخزن المنفصل لا يساوي آخر لقطة في دفتره'::text,
         s.stock_after, s.live_qty
    FROM (
      SELECT DISTINCT ON (m.store_name, m.item_id)
             m.store_name, m.item_id, m.stock_after,
             CASE m.store_name
               WHEN 'feed_raw_materials' THEN (SELECT f.stock FROM public.feed_raw_materials f WHERE f.id = m.item_id)
               WHEN 'feed_products' THEN (SELECT f.current_stock FROM public.feed_products f WHERE f.id = m.item_id)
               WHEN 'slaughterhouse_feed_inventory' THEN (SELECT f.current_kg FROM public.slaughterhouse_feed_inventory f WHERE f.id = m.item_id)
               WHEN 'brooding_feed_inventory' THEN (SELECT f.current_kg FROM public.brooding_feed_inventory f WHERE f.id = m.item_id)
               WHEN 'meat_factory_products' THEN (SELECT f.current_stock FROM public.meat_factory_products f WHERE f.id = m.item_id)
               ELSE NULL
             END AS live_qty
        FROM public.separate_stock_movements m
       ORDER BY m.store_name, m.item_id, m.created_at DESC
    ) s
   WHERE s.live_qty IS DISTINCT FROM s.stock_after;

  RETURN QUERY
  SELECT 'named_negative_stock'::text, NULL::uuid, f.id, 'feed_raw_materials'::text,
         f.name, NULL::numeric, f.stock
    FROM public.feed_raw_materials f
   WHERE f.stock < 0
  UNION ALL
  SELECT 'named_negative_stock', NULL::uuid, f.id, 'feed_products', f.name, NULL::numeric, f.current_stock
    FROM public.feed_products f WHERE f.current_stock < 0
  UNION ALL
  SELECT 'named_negative_stock', NULL::uuid, f.id, 'slaughterhouse_feed_inventory', f.feed_name, NULL::numeric, f.current_kg
    FROM public.slaughterhouse_feed_inventory f WHERE f.current_kg < 0
  UNION ALL
  SELECT 'named_negative_stock', NULL::uuid, f.id, 'brooding_feed_inventory', f.feed_name, NULL::numeric, f.current_kg
    FROM public.brooding_feed_inventory f WHERE f.current_kg < 0;
END;
$$;

COMMENT ON FUNCTION public.inventory_reconciliation_check(integer) IS
  'أساس مطابقة كروت inventory_items هو جرد معتمد في أو بعد 2026-09-30 بتوقيت أفريقيا/القاهرة لكل مخزن. أرصدة الافتتاح في 2 يونيو و18 يونيو تبقى في التاريخ ولا تُجمع فوق ذلك الجرد. كل مخزن منفصل (علف خام، تام علف، علف مجزر، علف حضانات، منتجات مصنع اللحوم) يُفحص من آخر لقطة في separate_stock_movements.';

REVOKE ALL ON FUNCTION public.inventory_reconciliation_check(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_reconciliation_check(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.closed_loop_open_items()
RETURNS TABLE(item text)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT unnest(ARRAY[
    'تغليف: القرار لم يصدر. المخزن الفعّال meat_factory_raw_items عبر packaging_store_name(). لا تُدمج الأرصدة الأربعة.',
    'meat_factory_finished_items.current_stock ما زال يُسوّى في جرد التام القديم (apply_meat_stocktake فرع غير الخام) بلا دفتر مفاتيح.',
    'مزامنة الفريزر sync_main_stock_to_sublocations مرآة للرصيد. تقرير يجمع الكارت والفريزر يعدّ الكمية مرتين.',
    'post_manual_inventory_movement وinv_post_movement يستخدمان source_id عشوائيًا. النقرة المزدوجة مستند جديد.',
    'دوال mf_* وpost_mf_* وapply_meat_production_item التي تكتب جداول التام/الخام/التغليف القديمة ستُرفض الآن. ليست مسار سبتمبر الحي.',
    'استلام mf_transfers ما زال يفتح بطاقة بكود الصنف إن لم يوجد منتج. المسار قديم وغير حي في سبتمبر.'
  ]::text[])
$$;

REVOKE ALL ON FUNCTION public.closed_loop_open_items() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.closed_loop_open_items() TO authenticated, service_role;
