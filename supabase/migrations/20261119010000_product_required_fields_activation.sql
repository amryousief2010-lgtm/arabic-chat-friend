-- Product master data gate (approved by المدير العام, 19 Nov 2026).
--
-- 1) Required fields on INSERT, and on UPDATE of the field itself:
--    * barcode: 13 digits and unique, OR barcode_pending = true («الكود تحت التسجيل»)
--    * cost_price > 0
--    * pack_weight_kg > 0
-- 2) New products always start inactive (is_active = false).
-- 3) Activation (is_active false -> true) only by general_manager or sales_manager,
--    and only when: required fields complete, stock > 0 in some warehouse, and for
--    «لحوم مصنعة» a finished item in the meat-factory warehouse resolves to this
--    product through resolve_inventory_transfer_destination() (the same mapping the
--    factory -> main warehouse transfer uses).
-- Existing rows are not touched. Unrelated updates (price, name, stock, ...) on
-- legacy incomplete products are not validated.

-- ── 1. column + defaults ─────────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode_pending boolean NOT NULL DEFAULT false;

ALTER TABLE public.products ALTER COLUMN is_active SET DEFAULT false;

GRANT SELECT (barcode_pending), INSERT (barcode_pending), UPDATE (barcode_pending)
  ON public.products TO authenticated;

-- ── 2. meat-factory link ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.product_meat_factory_items(p_product_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT fi.name ORDER BY fi.name), ARRAY[]::text[])
  FROM public.inventory_items fi
  JOIN public.warehouses fw ON fw.id = fi.warehouse_id
  JOIN public.inventory_items d
    ON d.id = public.resolve_inventory_transfer_destination(
                fi.id, '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid)
  WHERE fw.name ILIKE '%مصنع اللحوم%'
    AND fi.is_active = true
    AND d.product_id = p_product_id;
$fn$;

REVOKE ALL ON FUNCTION public.product_meat_factory_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_meat_factory_items(uuid) TO authenticated, service_role;

-- ── 3. activation blockers (pure check, given candidate values) ─────────────
CREATE OR REPLACE FUNCTION public._product_activation_blockers(
  p_product_id uuid,
  p_category text,
  p_barcode text,
  p_barcode_pending boolean,
  p_cost numeric,
  p_pack numeric
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_b text[] := ARRAY[]::text[];
  v_stock numeric;
BEGIN
  IF NULLIF(btrim(COALESCE(p_barcode, '')), '') IS NULL THEN
    IF NOT COALESCE(p_barcode_pending, false) THEN
      v_b := v_b || 'الكود (الباركود) غير مسجل ولم يُعلَّم «الكود تحت التسجيل»'::text;
    END IF;
  ELSIF btrim(p_barcode) !~ '^[0-9]{13}$' THEN
    v_b := v_b || 'الكود لازم يكون 13 رقم'::text;
  END IF;

  IF COALESCE(p_cost, 0) <= 0 THEN
    v_b := v_b || 'تكلفة المنتج غير مسجلة'::text;
  END IF;

  IF COALESCE(p_pack, 0) <= 0 THEN
    v_b := v_b || 'وزن العبوة غير مسجل'::text;
  END IF;

  IF btrim(COALESCE(p_category, '')) = 'لحوم مصنعة'
     AND COALESCE(array_length(public.product_meat_factory_items(p_product_id), 1), 0) = 0 THEN
    v_b := v_b || 'المنتج غير مربوط بصنف تام في مصنع اللحوم'::text;
  END IF;

  SELECT COALESCE(SUM(stock), 0) INTO v_stock
  FROM public.inventory_items
  WHERE product_id = p_product_id AND stock > 0;
  IF v_stock <= 0 THEN
    v_b := v_b || 'رصيد المنتج صفر في كل المخازن'::text;
  END IF;

  RETURN v_b;
END;
$fn$;

REVOKE ALL ON FUNCTION public._product_activation_blockers(uuid, text, text, boolean, numeric, numeric) FROM PUBLIC, anon, authenticated;

-- ── 4. readiness RPC for the products screen (no cost value exposed) ────────
CREATE OR REPLACE FUNCTION public.product_readiness(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  p public.products%ROWTYPE;
  v_stock numeric;
BEGIN
  -- EXECUTE is granted to authenticated and service_role only.
  SELECT * INTO p FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;

  SELECT COALESCE(SUM(stock), 0) INTO v_stock
  FROM public.inventory_items WHERE product_id = p.id AND stock > 0;

  RETURN jsonb_build_object(
    'product_id', p.id,
    'is_active', p.is_active,
    'has_barcode', NULLIF(btrim(COALESCE(p.barcode, '')), '') IS NOT NULL,
    'barcode_pending', p.barcode_pending,
    'cost_ok', COALESCE(p.cost_price, 0) > 0,
    'pack_weight_kg', p.pack_weight_kg,
    'is_processed', btrim(COALESCE(p.category, '')) = 'لحوم مصنعة',
    'factory_items', to_jsonb(public.product_meat_factory_items(p.id)),
    'stock_total', v_stock,
    'can_activate_role', v_uid IS NULL OR public.has_any_role(v_uid, ARRAY['general_manager','sales_manager']::public.app_role[]),
    'blockers', to_jsonb(public._product_activation_blockers(
       p.id, p.category, p.barcode, p.barcode_pending, p.cost_price, p.pack_weight_kg))
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.product_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_readiness(uuid) TO authenticated, service_role;

-- ── 5. trigger: required fields + inactive insert + activation gate ─────────
CREATE OR REPLACE FUNCTION public.products_enforce_required_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_dup text;
  v_blockers text[];
  v_check_barcode boolean;
  v_check_cost boolean;
  v_check_pack boolean;
BEGIN
  -- normalise barcode: trim, empty -> NULL
  NEW.barcode := NULLIF(btrim(COALESCE(NEW.barcode, '')), '');
  NEW.barcode_pending := COALESCE(NEW.barcode_pending, false);

  IF TG_OP = 'INSERT' THEN
    NEW.is_active := false;  -- new products always start inactive
    v_check_barcode := true;
    v_check_cost := true;
    v_check_pack := true;
  ELSE
    v_check_barcode := NEW.barcode IS DISTINCT FROM OLD.barcode
                    OR NEW.barcode_pending IS DISTINCT FROM OLD.barcode_pending;
    v_check_cost := NEW.cost_price IS DISTINCT FROM OLD.cost_price;
    v_check_pack := NEW.pack_weight_kg IS DISTINCT FROM OLD.pack_weight_kg;
  END IF;

  IF v_check_barcode THEN
    IF NEW.barcode IS NULL THEN
      IF NOT NEW.barcode_pending THEN
        RAISE EXCEPTION 'PRODUCT_BARCODE_REQUIRED: اكتب كود المنتج (13 رقم) أو علّم «الكود تحت التسجيل»'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF NEW.barcode !~ '^[0-9]{13}$' THEN
        RAISE EXCEPTION 'PRODUCT_BARCODE_INVALID: كود المنتج لازم يكون 13 رقم بالظبط'
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT name INTO v_dup FROM public.products
       WHERE barcode = NEW.barcode AND id <> NEW.id LIMIT 1;
      IF v_dup IS NOT NULL THEN
        RAISE EXCEPTION 'PRODUCT_BARCODE_DUPLICATE: الكود مستخدم بالفعل للمنتج «%»', v_dup
          USING ERRCODE = 'unique_violation';
      END IF;
      NEW.barcode_pending := false;
    END IF;
  END IF;

  IF v_check_cost AND COALESCE(NEW.cost_price, 0) <= 0 THEN
    RAISE EXCEPTION 'PRODUCT_COST_REQUIRED: تكلفة المنتج لازم تكون أكبر من صفر'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_check_pack AND COALESCE(NEW.pack_weight_kg, 0) <= 0 THEN
    RAISE EXCEPTION 'PRODUCT_PACK_WEIGHT_REQUIRED: وزن العبوة (كجم) لازم يكون أكبر من صفر'
      USING ERRCODE = 'check_violation';
  END IF;

  -- activation gate
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, false) = false AND NEW.is_active = true THEN
    IF v_uid IS NOT NULL AND NOT public.has_any_role(
         v_uid, ARRAY['general_manager','sales_manager']::public.app_role[]) THEN
      RAISE EXCEPTION 'PRODUCT_ACTIVATION_NOT_ALLOWED: تفعيل المنتج للمدير العام أو مدير المبيعات فقط'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_blockers := public._product_activation_blockers(
      NEW.id, NEW.category, NEW.barcode, NEW.barcode_pending, NEW.cost_price, NEW.pack_weight_kg);
    IF COALESCE(array_length(v_blockers, 1), 0) > 0 THEN
      RAISE EXCEPTION 'PRODUCT_ACTIVATION_BLOCKED: %', array_to_string(v_blockers, ' — ')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_01_products_required_fields ON public.products;
CREATE TRIGGER trg_01_products_required_fields
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_enforce_required_fields();

-- ── 6. auto-link: a new (inactive) product still gets its warehouse cards ───
-- Without this an inactive product has no inventory_items, so it can never
-- receive stock, and can never be activated.
CREATE OR REPLACE FUNCTION public.auto_link_product_to_customer_warehouses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  wh_ids uuid[] := ARRAY[
    '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid,
    'a970d469-37df-40e1-b99f-a49195a3778e'::uuid,
    '07ce03a3-2250-4894-b7f6-c7b79445edab'::uuid,
    '7178babf-83ab-4868-a298-e6507ff3d987'::uuid
  ];
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(NEW.is_active, true) = false THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.inventory_items (warehouse_id, product_id, name, category, unit, stock, unit_cost, is_active, module)
  SELECT w, NEW.id, NEW.name, NEW.category, COALESCE(NEW.unit,'قطعة'), 0, COALESCE(NEW.cost_price,0), true, 'sales'
  FROM unnest(wh_ids) AS w
  WHERE NOT EXISTS (
    SELECT 1 FROM public.inventory_items ii
    WHERE ii.product_id = NEW.id AND ii.warehouse_id = w
  );

  RETURN NEW;
END;
$function$;

-- ── 7. activation RPC ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_product(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  p public.products%ROWTYPE;
  v_blockers text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['general_manager','sales_manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'PRODUCT_ACTIVATION_NOT_ALLOWED: تفعيل المنتج للمدير العام أو مدير المبيعات فقط'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO p FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;
  IF p.is_active THEN
    RETURN jsonb_build_object('ok', true, 'already_active', true);
  END IF;

  v_blockers := public._product_activation_blockers(
    p.id, p.category, p.barcode, p.barcode_pending, p.cost_price, p.pack_weight_kg);
  IF COALESCE(array_length(v_blockers, 1), 0) > 0 THEN
    RAISE EXCEPTION 'PRODUCT_ACTIVATION_BLOCKED: %', array_to_string(v_blockers, ' — ')
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.products SET is_active = true, updated_at = now() WHERE id = p.id;
  RETURN jsonb_build_object('ok', true, 'already_active', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.activate_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_product(uuid) TO authenticated;
