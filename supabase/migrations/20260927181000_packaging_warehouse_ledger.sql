-- Owner decision: every packaging quantity lives on inventory_items in
-- مخزن أدوات التغليف. Manufacturing deducts that card directly
-- (packaging_consumption, source = invoice + line). Factory packaging rows,
-- meat_packaging_inventory, packaging_materials, and main-warehouse packaging
-- cards stay as history and reject stock changes.

ALTER TABLE public.packaging_store_setting
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id);

CREATE OR REPLACE FUNCTION public.ensure_packaging_warehouse()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT s.warehouse_id INTO v_id
    FROM public.packaging_store_setting s
   WHERE s.id = 1
     AND s.warehouse_id IS NOT NULL;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT w.id INTO v_id
    FROM public.warehouses w
   WHERE w.name = 'مخزن أدوات التغليف'
      OR (
        w.name ILIKE '%تغليف%'
        AND w.name NOT ILIKE '%مصنع%'
        AND w.name NOT ILIKE '%خامات%'
      )
   ORDER BY (w.name = 'مخزن أدوات التغليف') DESC,
            (SELECT count(*) FROM public.inventory_items i WHERE i.warehouse_id = w.id) DESC,
            w.created_at
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.warehouses (name, type, location, description, is_active)
    VALUES (
      'مخزن أدوات التغليف',
      'packaging',
      'مخزن أدوات التغليف',
      'مخزن التغليف الوحيد. الخصم والشراء على بطاقاته.',
      true
    )
    RETURNING id INTO v_id;
  END IF;

  UPDATE public.packaging_store_setting
     SET warehouse_id = v_id,
         active_packaging_store = 'inventory_items',
         note = 'قرار المالك: كل التغليف في مخزن أدوات التغليف (inventory_items). لا تحويل من المصنع.',
         updated_at = now()
   WHERE id = 1;

  INSERT INTO public.warehouse_role_grants (warehouse_id, role, capability)
  SELECT v_id, r.role, c.capability
    FROM (
      VALUES
        ('warehouse_supervisor'::public.app_role),
        ('meat_factory_manager'::public.app_role)
    ) AS r(role)
    CROSS JOIN (
      VALUES ('receive'), ('send'), ('post_manual'), ('post_purchase'),
             ('post_waste'), ('post_packaging')
    ) AS c(capability)
  ON CONFLICT (warehouse_id, role, capability) DO NOTHING;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_packaging_warehouse() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_packaging_warehouse() TO service_role;

SELECT public.ensure_packaging_warehouse();

CREATE OR REPLACE FUNCTION public.packaging_warehouse_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.warehouse_id
    FROM public.packaging_store_setting s
   WHERE s.id = 1
$$;

CREATE OR REPLACE FUNCTION public.packaging_store_name()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT w.name
       FROM public.packaging_store_setting s
       JOIN public.warehouses w ON w.id = s.warehouse_id
      WHERE s.id = 1),
    'مخزن أدوات التغليف'
  )
$$;

COMMENT ON FUNCTION public.packaging_store_name() IS
  'مخزن التغليف الوحيد: مخزن أدوات التغليف وبطاقاته في inventory_items.';

REVOKE ALL ON FUNCTION public.packaging_warehouse_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.packaging_store_name() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.packaging_warehouse_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.packaging_store_name() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.packaging_card_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL CHECK (source_kind IN (
    'meat_factory_raw_item', 'recipe_line', 'packaging_material', 'meat_packaging_inventory'
  )),
  source_id uuid,
  source_name text NOT NULL,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS packaging_card_map_source_uidx
  ON public.packaging_card_map (source_kind, source_id)
  WHERE source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS packaging_card_map_name_uidx
  ON public.packaging_card_map (source_kind, public.normalize_ar_name(source_name));

ALTER TABLE public.packaging_card_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS packaging_card_map_read ON public.packaging_card_map;
CREATE POLICY packaging_card_map_read ON public.packaging_card_map
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.packaging_card_map TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_packaging_card(
  p_raw_item_id uuid,
  p_name text,
  p_create boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_n int;
  v_wh uuid := public.packaging_warehouse_id();
  v_name text := btrim(COALESCE(p_name, ''));
  v_unit text;
BEGIN
  IF v_wh IS NULL THEN
    RAISE EXCEPTION 'مخزن التغليف غير محدد';
  END IF;

  IF p_raw_item_id IS NOT NULL THEN
    SELECT m.inventory_item_id INTO v_id
      FROM public.packaging_card_map m
     WHERE m.source_kind = 'meat_factory_raw_item'
       AND m.source_id = p_raw_item_id;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
    IF v_name = '' THEN
      SELECT r.name, r.unit INTO v_name, v_unit
        FROM public.meat_factory_raw_items r
       WHERE r.id = p_raw_item_id;
    ELSE
      SELECT r.unit INTO v_unit
        FROM public.meat_factory_raw_items r
       WHERE r.id = p_raw_item_id;
    END IF;
  END IF;

  IF v_name = '' THEN
    RETURN NULL;
  END IF;

  SELECT count(*), (array_agg(i.id ORDER BY i.created_at))[1]
    INTO v_n, v_id
    FROM public.inventory_items i
   WHERE i.warehouse_id = v_wh
     AND public.normalize_ar_name(i.name) = public.normalize_ar_name(v_name);

  IF v_n > 1 THEN
    RAISE EXCEPTION 'تغليف باسم % يطابق أكثر من بطاقة في مخزن التغليف. حدّد البطاقة قبل الاعتماد.', v_name;
  END IF;

  IF v_n = 1 THEN
    INSERT INTO public.packaging_card_map (source_kind, source_id, source_name, inventory_item_id)
    VALUES ('meat_factory_raw_item', p_raw_item_id, v_name, v_id)
    ON CONFLICT DO NOTHING;
    RETURN v_id;
  END IF;

  IF NOT COALESCE(p_create, false) OR p_raw_item_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.inventory_items (name, warehouse_id, category, unit, stock)
  VALUES (v_name, v_wh, 'تغليف', COALESCE(NULLIF(v_unit, ''), 'قطعة'), 0)
  RETURNING id INTO v_id;

  INSERT INTO public.packaging_card_map (source_kind, source_id, source_name, inventory_item_id)
  VALUES ('meat_factory_raw_item', p_raw_item_id, v_name, v_id)
  ON CONFLICT DO NOTHING;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_packaging_card(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_packaging_card(uuid, text, boolean) TO authenticated, service_role;

-- Seed unambiguous name matches. Ambiguous and missing names stay unmapped.
INSERT INTO public.packaging_card_map (source_kind, source_id, source_name, inventory_item_id)
SELECT 'meat_factory_raw_item', r.id, r.name, i.id
  FROM public.meat_factory_raw_items r
  JOIN public.inventory_items i
    ON i.warehouse_id = public.packaging_warehouse_id()
   AND public.normalize_ar_name(i.name) = public.normalize_ar_name(r.name)
 WHERE r.kind = 'packaging'
   AND (
     SELECT count(*)
       FROM public.inventory_items i2
      WHERE i2.warehouse_id = public.packaging_warehouse_id()
        AND public.normalize_ar_name(i2.name) = public.normalize_ar_name(r.name)
   ) = 1
ON CONFLICT DO NOTHING;

INSERT INTO public.packaging_card_map (source_kind, source_name, inventory_item_id)
SELECT 'recipe_line', m.recipe_item_name, c.inventory_item_id
  FROM public.meat_recipe_item_mappings m
  JOIN public.packaging_card_map c
    ON c.source_kind = 'meat_factory_raw_item'
   AND c.source_id = m.mapped_raw_item_id
 WHERE m.recipe_item_kind = 'packaging'
ON CONFLICT DO NOTHING;

INSERT INTO public.packaging_card_map (source_kind, source_name, inventory_item_id)
SELECT 'recipe_line', src.name, src.card_id
  FROM (
    SELECT m.recipe_item_name AS name, min(i.id::text)::uuid AS card_id, count(*) AS n
      FROM public.meat_recipe_item_mappings m
      JOIN public.inventory_items i
        ON i.warehouse_id = public.packaging_warehouse_id()
       AND public.normalize_ar_name(i.name) = public.normalize_ar_name(m.recipe_item_name)
     WHERE m.recipe_item_kind = 'packaging'
     GROUP BY m.recipe_item_name
  ) src
 WHERE src.n = 1
ON CONFLICT DO NOTHING;

INSERT INTO public.packaging_card_map (source_kind, source_name, inventory_item_id)
SELECT 'recipe_line', src.name, src.card_id
  FROM (
    SELECT r.material_name_ar AS name, min(i.id::text)::uuid AS card_id, count(*) AS n
      FROM public.meat_factory_recipes r
      JOIN public.inventory_items i
        ON i.warehouse_id = public.packaging_warehouse_id()
       AND public.normalize_ar_name(i.name) = public.normalize_ar_name(r.material_name_ar)
     WHERE r.material_name_ar IS NOT NULL
       AND (
         COALESCE(r.warehouse, '') ILIKE '%تغليف%'
         OR COALESCE(r.unit, '') ILIKE '%علب%'
         OR COALESCE(r.unit, '') ILIKE '%كيس%'
       )
     GROUP BY r.material_name_ar
  ) src
 WHERE src.n = 1
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.list_unmapped_packaging()
RETURNS TABLE(source_kind text, source_id uuid, source_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 'meat_factory_raw_item'::text, r.id, r.name
    FROM public.meat_factory_raw_items r
   WHERE r.kind = 'packaging'
     AND COALESCE(r.is_active, true)
     AND NOT EXISTS (
       SELECT 1 FROM public.packaging_card_map m
        WHERE m.source_kind = 'meat_factory_raw_item' AND m.source_id = r.id
     )
  UNION ALL
  SELECT 'recipe_line'::text, NULL::uuid, m.recipe_item_name
    FROM public.meat_recipe_item_mappings m
   WHERE m.recipe_item_kind = 'packaging'
     AND NOT EXISTS (
       SELECT 1 FROM public.packaging_card_map c
        WHERE c.source_kind = 'recipe_line'
          AND public.normalize_ar_name(c.source_name) = public.normalize_ar_name(m.recipe_item_name)
     )
  ORDER BY 1, 3
$$;

REVOKE ALL ON FUNCTION public.list_unmapped_packaging() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_unmapped_packaging() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.packaging_line_availability(p_item_ids uuid[])
RETURNS TABLE(item_id uuid, item_name text, mapped boolean, card_id uuid, card_name text, stock numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.id,
         r.name,
         m.inventory_item_id IS NOT NULL,
         m.inventory_item_id,
         i.name,
         COALESCE(i.stock, 0)
    FROM public.meat_factory_raw_items r
    LEFT JOIN public.packaging_card_map m
      ON m.source_kind = 'meat_factory_raw_item' AND m.source_id = r.id
    LEFT JOIN public.inventory_items i ON i.id = m.inventory_item_id
   WHERE r.id = ANY(COALESCE(p_item_ids, ARRAY[]::uuid[]))
$$;

REVOKE ALL ON FUNCTION public.packaging_line_availability(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.packaging_line_availability(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.post_packaging_warehouse_move(
  p_raw_item_id uuid,
  p_quantity numeric,
  p_direction text,
  p_unit_cost numeric,
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_source_line text,
  p_create_card boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item public.meat_factory_raw_items%ROWTYPE;
  v_card uuid;
  v_dir text := upper(btrim(COALESCE(p_direction, '')));
  v_type text;
  v_source text;
  v_res jsonb;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: سبب الحركة مطلوب';
  END IF;
  SELECT * INTO v_item FROM public.meat_factory_raw_items WHERE id = p_raw_item_id;
  IF NOT FOUND OR v_item.kind IS DISTINCT FROM 'packaging' THEN
    RAISE EXCEPTION 'الصنف ليس تغليفاً في مصنع اللحوم';
  END IF;
  IF v_dir NOT IN ('IN', 'OUT') THEN
    RAISE EXCEPTION 'INVALID_DIRECTION';
  END IF;
  v_card := public.resolve_packaging_card(p_raw_item_id, v_item.name, COALESCE(p_create_card, false) OR v_dir = 'IN');
  IF v_card IS NULL THEN
    RAISE EXCEPTION 'تغليف غير مربوط بمخزن التغليف: %', v_item.name;
  END IF;
  v_type := CASE WHEN v_dir = 'IN' THEN 'in' ELSE 'out' END;
  v_source := COALESCE(NULLIF(btrim(COALESCE(p_source_type, '')), ''), CASE WHEN v_dir = 'IN' THEN 'manual_in' ELSE 'manual_out' END);
  PERFORM set_config('app.inventory_internal_post', 'on', true);
  v_res := public.post_inventory_movement(
    v_card, v_type, abs(p_quantity), v_source,
    COALESCE(p_source_id, gen_random_uuid()), COALESCE(NULLIF(btrim(COALESCE(p_source_line, '')), ''), '1'),
    btrim(p_reason),
    'تغليف ' || v_item.name,
    now(), p_unit_cost, NULL, NULL,
    'delta', false, public.packaging_warehouse_id(), NULL, 'packaging', NULL, NULL,
    v_source, NULL, NULL, NULL, NULL, NULL
  );
  PERFORM set_config('app.inventory_internal_post', 'off', true);
  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.post_packaging_warehouse_move(uuid, numeric, text, numeric, text, text, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_packaging_warehouse_move(uuid, numeric, text, numeric, text, text, uuid, text, boolean) TO authenticated, service_role;

-- Factory packaging stock, and main-warehouse packaging cards, are history.
CREATE OR REPLACE FUNCTION public.reject_factory_packaging_stock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.kind, '') = 'packaging' AND COALESCE(NEW.current_stock, 0) <> 0 THEN
      RAISE EXCEPTION 'PACKAGING_HISTORY_READONLY: رصيد تغليف مصنع اللحوم للقراءة فقط. أدخل الكمية على بطاقة مخزن التغليف.';
    END IF;
    RETURN NEW;
  END IF;
  IF (COALESCE(NEW.kind, '') = 'packaging' OR COALESCE(OLD.kind, '') = 'packaging')
     AND NEW.current_stock IS DISTINCT FROM OLD.current_stock THEN
    RAISE EXCEPTION 'PACKAGING_HISTORY_READONLY: رصيد تغليف مصنع اللحوم للقراءة فقط. الشراء والخصم يتمان على مخزن التغليف.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_packaging_history_raw ON public.meat_factory_raw_items;
CREATE TRIGGER trg_00_packaging_history_raw
  BEFORE INSERT OR UPDATE OF current_stock ON public.meat_factory_raw_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_factory_packaging_stock();

CREATE OR REPLACE FUNCTION public.reject_main_packaging_card_stock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_main boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stock IS NOT DISTINCT FROM OLD.stock THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND COALESCE(NEW.stock, 0) = 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.warehouse_id IS NOT DISTINCT FROM public.packaging_warehouse_id() THEN
    RETURN NEW;
  END IF;
  SELECT NEW.warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid
      OR COALESCE(w.name, '') ILIKE '%الرئيسي%'
    INTO v_main
    FROM public.warehouses w
   WHERE w.id = NEW.warehouse_id;
  IF NOT COALESCE(v_main, false) THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.category, '') ILIKE '%تغليف%'
     OR COALESCE(NEW.category, '') ILIKE '%packaging%'
     OR EXISTS (
       SELECT 1 FROM public.meat_factory_raw_items r
        WHERE r.kind = 'packaging'
          AND public.normalize_ar_name(r.name) = public.normalize_ar_name(NEW.name)
     )
     OR EXISTS (
       SELECT 1 FROM public.inventory_items p
        WHERE p.warehouse_id = public.packaging_warehouse_id()
          AND public.normalize_ar_name(p.name) = public.normalize_ar_name(NEW.name)
     ) THEN
    RAISE EXCEPTION 'PACKAGING_HISTORY_READONLY: بطاقة التغليف في المخزن الرئيسي للقراءة فقط. الرصيد الحي في مخزن التغليف.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_packaging_history_main ON public.inventory_items;
CREATE TRIGGER trg_00_packaging_history_main
  BEFORE INSERT OR UPDATE OF stock ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_main_packaging_card_stock();

-- Stop the factory raw ledger from moving packaging rows.
DO $patch_raw$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'post_meat_raw_movement'
   ORDER BY p.oid DESC
   LIMIT 1;
  IF def LIKE '%PACKAGING_HISTORY_READONLY%' THEN
    RETURN;
  END IF;
  def := replace(
    def,
    'IF NOT FOUND THEN RAISE EXCEPTION ''الصنف غير موجود في خامات مصنع اللحوم''; END IF;',
    'IF NOT FOUND THEN RAISE EXCEPTION ''الصنف غير موجود في خامات مصنع اللحوم''; END IF;'
    || E'\n  IF v_item.kind = ''packaging'' OR COALESCE(p_item_kind, '''') = ''packaging'' THEN'
    || E'\n    RAISE EXCEPTION ''PACKAGING_HISTORY_READONLY: رصيد تغليف مصنع اللحوم للقراءة فقط. الشراء والخصم يتمان على مخزن التغليف.'';'
    || E'\n  END IF;'
  );
  EXECUTE def;
END;
$patch_raw$;

DO $patch_adjust$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'meat_factory_adjust_stock'
   ORDER BY p.oid DESC
   LIMIT 1;
  IF def LIKE '%PACKAGING_HISTORY_READONLY%' THEN
    RETURN;
  END IF;
  def := replace(
    def,
    'IF p_item_kind NOT IN (''raw'',''spice'',''packaging'',''finished'') THEN',
    'IF p_item_kind = ''packaging'' THEN'
    || E'\n    RAISE EXCEPTION ''PACKAGING_HISTORY_READONLY: تسوية تغليف المصنع متوقفة. عدّل بطاقة مخزن التغليف.'';'
    || E'\n  END IF;'
    || E'\n  IF p_item_kind NOT IN (''raw'',''spice'',''packaging'',''finished'') THEN'
  );
  EXECUTE def;
END;
$patch_adjust$;

-- Purchases of packaging post into the packaging warehouse.
CREATE OR REPLACE FUNCTION public.approve_meat_purchase(p_purchase_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_p RECORD;
  v_line RECORD;
  v_txn uuid;
  v_new_avg numeric;
  v_old_stock numeric;
  v_old_cost numeric;
  v_kind text;
  v_card uuid;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')) THEN
    RAISE EXCEPTION 'الاعتماد متاح للمدير العام أو المدير التنفيذي فقط';
  END IF;

  SELECT * INTO v_p FROM meat_factory_purchases WHERE id = p_purchase_id FOR UPDATE;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF v_p.status = 'approved' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;
  IF v_p.status = 'rejected' OR v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن اعتماد فاتورة مرفوضة أو ملغاة';
  END IF;

  IF v_p.invoice_no IS NULL THEN
    UPDATE meat_factory_purchases SET invoice_no = gen_meat_purchase_invoice_no() WHERE id = p_purchase_id;
  END IF;

  FOR v_line IN SELECT * FROM meat_factory_purchase_lines WHERE purchase_id = p_purchase_id LOOP
    SELECT current_stock, avg_cost, kind INTO v_old_stock, v_old_cost, v_kind
      FROM meat_factory_raw_items WHERE id = v_line.raw_item_id FOR UPDATE;
    IF v_old_stock IS NULL THEN
      RAISE EXCEPTION 'صنف غير موجود في مخزن الخامات: %', v_line.raw_item_name;
    END IF;

    IF COALESCE(v_line.kind, v_kind, 'raw') = 'packaging' THEN
      v_card := public.resolve_packaging_card(v_line.raw_item_id, v_line.raw_item_name, true);
      PERFORM set_config('app.inventory_internal_post', 'on', true);
      PERFORM public.post_inventory_movement(
        v_card, 'in', v_line.quantity, 'purchase',
        p_purchase_id, v_line.id::text,
        'شراء تغليف',
        'فاتورة شراء ' || COALESCE(v_p.invoice_no, ''),
        now(), v_line.unit_price, v_p.supplier, v_p.invoice_no,
        'delta', false, public.packaging_warehouse_id(), NULL, 'packaging', NULL, NULL,
        'purchase', p_purchase_id::text, NULL, NULL, NULL, NULL
      );
      PERFORM set_config('app.inventory_internal_post', 'off', true);
      CONTINUE;
    END IF;

    v_new_avg := CASE WHEN (v_old_stock + v_line.quantity) = 0 THEN v_line.unit_price
                      ELSE ((v_old_stock * v_old_cost) + (v_line.quantity * v_line.unit_price)) / (v_old_stock + v_line.quantity) END;

    PERFORM public.post_meat_raw_movement(
      v_line.raw_item_id, 'IN', v_line.quantity, v_line.unit_price,
      'شراء خامات', 'meat_factory_purchases', p_purchase_id,
      COALESCE(v_line.kind, v_kind, 'raw'), 'delta', NULL, v_new_avg, v_line.raw_item_name
    );
  END LOOP;

  IF v_p.payment_method = 'cash' AND v_p.total_amount > 0 THEN
    INSERT INTO meat_factory_treasury_txns(txn_date, direction, amount, reason, ref_table, ref_id, created_by)
    VALUES (v_p.purchase_date, 'OUT', v_p.total_amount, 'شراء خامات مصنع اللحوم', 'meat_factory_purchases', p_purchase_id, auth.uid())
    RETURNING id INTO v_txn;
  END IF;

  UPDATE meat_factory_purchases
     SET status = 'approved', approved_at = now(), approved_by = auth.uid(), treasury_txn_id = v_txn
   WHERE id = p_purchase_id;

  INSERT INTO meat_factory_audit_log(table_name, row_id, action, new_value, performed_by)
  VALUES (
    'meat_factory_purchases', p_purchase_id, 'approve',
    jsonb_build_object('total', v_p.total_amount, 'supplier', v_p.supplier), auth.uid()
  );

  RETURN p_purchase_id;
END
$function$;

-- Manufacturing: block unmapped packaging, deduct the warehouse card, never the factory row.
DO $patch_approve$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'approve_meat_manufacturing_invoice'
   ORDER BY p.oid DESC
   LIMIT 1;
  IF def LIKE '%resolve_packaging_card%' THEN
    RETURN;
  END IF;
  IF position('v_finished_existed boolean := false;' IN def) = 0 THEN
    RAISE EXCEPTION 'approve packaging patch lost its anchor';
  END IF;
  def := replace(
    def,
    'v_finished_existed boolean := false;',
    'v_finished_existed boolean := false;'
    || E'\n  v_line public.meat_manufacturing_invoice_lines%ROWTYPE;'
    || E'\n  v_card uuid;'
    || E'\n  v_unmapped text;'
    || E'\n  v_pack_before numeric;'
  );
  def := replace(
    def,
    'IF v_inv.status IN (''rejected'',''cancelled'') THEN
    RAISE EXCEPTION ''لا يمكن اعتماد فاتورة بحالة %'', v_inv.status;
  END IF;',
    'IF v_inv.status IN (''rejected'',''cancelled'') THEN
    RAISE EXCEPTION ''لا يمكن اعتماد فاتورة بحالة %'', v_inv.status;
  END IF;

  SELECT string_agg(s.item_name, ''، '' ORDER BY s.item_name) INTO v_unmapped
    FROM (
      SELECT DISTINCT l.item_name
        FROM public.meat_manufacturing_invoice_lines l
       WHERE l.invoice_id = p_invoice_id
         AND l.kind = ''packaging''
         AND public.resolve_packaging_card(l.item_id, l.item_name, false) IS NULL
    ) s;
  IF v_unmapped IS NOT NULL THEN
    RAISE EXCEPTION ''تغليف غير مربوط بمخزن التغليف: %. اربط كل صنف ببطاقة في مخزن التغليف قبل الاعتماد.'', v_unmapped;
  END IF;'
  );
  def := replace(
    def,
    'SELECT * INTO v_item FROM public.meat_factory_raw_items WHERE id = v_agg.item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION ''الصنف غير موجود في مخزن خامات مصنع اللحوم: %'', v_agg.item_name; END IF;',
    'IF v_agg.kind = ''packaging'' THEN
      v_pack_cost := v_pack_cost + v_agg.line_total;
      v_total := v_total + v_agg.line_total;
      v_lines := v_lines + 1;
      CONTINUE;
    END IF;
    SELECT * INTO v_item FROM public.meat_factory_raw_items WHERE id = v_agg.item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION ''الصنف غير موجود في مخزن خامات مصنع اللحوم: %'', v_agg.item_name; END IF;'
  );
  def := replace(
    def,
    '-- Finished product item (reuse / create)',
    'FOR v_line IN
    SELECT * FROM public.meat_manufacturing_invoice_lines
     WHERE invoice_id = p_invoice_id AND kind = ''packaging''
  LOOP
    v_card := public.resolve_packaging_card(v_line.item_id, v_line.item_name, false);
    SELECT COALESCE(stock, 0) INTO v_pack_before FROM public.inventory_items WHERE id = v_card;
    PERFORM set_config(''app.inventory_internal_post'', ''on'', true);
    PERFORM public.post_inventory_movement(
      v_card, ''packaging_consumption'', v_line.quantity, ''packaging_consumption'',
      p_invoice_id, v_line.id::text,
      ''استهلاك تغليف — '' || v_inv.product_name,
      ''فاتورة تصنيع '' || COALESCE(v_inv.invoice_no, ''''),
      now(), v_line.unit_cost, ''مصنع اللحوم'', v_inv.invoice_no,
      ''delta'', false, public.packaging_warehouse_id(), NULL, ''packaging'', NULL, NULL,
      ''packaging_consumption'', p_invoice_id::text, NULL, NULL, NULL, NULL
    );
    PERFORM set_config(''app.inventory_internal_post'', ''off'', true);
    UPDATE public.meat_manufacturing_invoice_lines
       SET stock_before = v_pack_before,
           stock_after = v_pack_before - v_line.quantity
     WHERE id = v_line.id;
  END LOOP;

  -- Finished product item (reuse / create)'
  );
  IF def NOT LIKE '%resolve_packaging_card%' OR def NOT LIKE '%packaging_consumption%' THEN
    RAISE EXCEPTION 'approve packaging patch did not apply';
  END IF;
  EXECUTE def;
END;
$patch_approve$;

-- Cancel reverses each packaging consumption once and does not write factory packaging stock.
DO $patch_cancel$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cancel_meat_manufacturing_invoice'
   ORDER BY p.oid DESC
   LIMIT 1;
  IF def LIKE '%packaging_consumption%' AND def LIKE '%v_item.kind = ''packaging''%' THEN
    RETURN;
  END IF;
  IF position('v_orig uuid;' IN def) = 0 THEN
    RAISE EXCEPTION 'cancel packaging patch lost v_orig';
  END IF;
  def := replace(def, 'v_orig uuid;', 'v_orig uuid; v_pack_mov uuid;');
  def := replace(
    def,
    'SELECT * INTO v_item FROM public.meat_factory_raw_items
      WHERE id = v_move.item_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;',
    'SELECT * INTO v_item FROM public.meat_factory_raw_items
      WHERE id = v_move.item_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF COALESCE(v_item.kind, v_move.item_kind) = ''packaging'' THEN CONTINUE; END IF;'
  );
  def := replace(
    def,
    '-- 2c) Reverse finished-product IN with OUT',
    'PERFORM set_config(''app.inventory_internal_post'', ''on'', true);
  FOR v_pack_mov IN
    SELECT mv.id
      FROM public.inventory_movements mv
     WHERE mv.source_type = ''packaging_consumption''
       AND mv.source_id = p_invoice_id
       AND COALESCE(mv.approval_status, ''posted'') = ''posted''
       AND mv.reverses_movement_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.inventory_movements r
          WHERE r.reverses_movement_id = mv.id
            AND COALESCE(r.approval_status, ''posted'') = ''posted''
       )
  LOOP
    PERFORM public.reverse_posted_inventory_movement(v_pack_mov, p_reason);
  END LOOP;
  PERFORM set_config(''app.inventory_internal_post'', ''off'', true);

  -- 2c) Reverse finished-product IN with OUT'
  );
  IF def NOT LIKE '%packaging_consumption%' THEN
    RAISE EXCEPTION 'cancel packaging patch did not apply';
  END IF;
  EXECUTE def;
END;
$patch_cancel$;

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

  RETURN QUERY
  SELECT 'packaging_unmapped'::text, public.packaging_warehouse_id(), u.source_id, u.source_kind,
         'تغليف غير مربوط: ' || u.source_name, NULL::numeric, NULL::numeric
    FROM public.list_unmapped_packaging() u;

  RETURN QUERY
  SELECT 'packaging_posted_outside'::text, i.warehouse_id, m.item_id, m.source_id::text,
         'استهلاك تغليف خارج مخزن التغليف'::text, NULL::numeric, m.quantity
    FROM public.inventory_movements m
    JOIN public.inventory_items i ON i.id = m.item_id
   WHERE m.movement_type = 'packaging_consumption'
     AND COALESCE(m.approval_status, 'posted') = 'posted'
     AND i.warehouse_id IS DISTINCT FROM public.packaging_warehouse_id();
END;
$$;

COMMENT ON FUNCTION public.inventory_reconciliation_check(integer) IS
  'أساس مطابقة كروت inventory_items هو جرد معتمد في أو بعد 2026-09-30 بتوقيت أفريقيا/القاهرة. أرصدة 2 يونيو و18 يونيو لا تُجمع فوق الجرد. التغليف الحي هو بطاقات مخزن أدوات التغليف. packaging_unmapped وpackaging_posted_outside يفحصان الربط ومكان الخصم.';

REVOKE ALL ON FUNCTION public.inventory_reconciliation_check(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_reconciliation_check(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.closed_loop_open_items()
RETURNS TABLE(item text)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT unnest(ARRAY[
    'تغليف: القرار صدر. المخزن الحي هو مخزن أدوات التغليف عبر packaging_warehouse_id(). أرصدة المصنع والجداول القديمة والتغليف في الرئيسي تاريخ للقراءة فقط.',
    'meat_factory_finished_items.current_stock ما زال يُسوّى في جرد التام القديم (apply_meat_stocktake فرع غير الخام) بلا دفتر مفاتيح.',
    'مزامنة الفريزر sync_main_stock_to_sublocations مرآة للرصيد. تقرير يجمع الكارت والفريزر يعدّ الكمية مرتين.',
    'post_manual_inventory_movement وinv_post_movement يستخدمان source_id عشوائيًا. النقرة المزدوجة مستند جديد.',
    'دوال mf_* وpost_mf_* وapply_meat_production_item التي تكتب جداول التام/الخام/التغليف القديمة ستُرفض الآن. ليست مسار سبتمبر الحي.',
    'استلام mf_transfers ما زال يفتح بطاقة بكود الصنف إن لم يوجد منتج. المسار قديم وغير حي في سبتمبر.',
    'إلغاء فاتورة تصنيع قديمة خصمت التغليف من المصنع لا يعيد تلك الكمية إلى مخزن التغليف. العكس يغطي استهلاك التغليف المرحّل بعد هذا القرار فقط.'
  ]::text[])
$$;
