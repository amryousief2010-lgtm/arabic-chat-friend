-- Product rename safety (approved by المدير العام, 26 Nov 2026).
--
-- 1) Backfill inventory_items.product_id on active meat-factory finished cards that resolve
--    to exactly one product. Ambiguous / unmatched cards are recorded and left unlinked.
-- 2) resolve_inventory_transfer_destination: product_id first, then item_code, then
--    canonical_wh_item_name() on BOTH sides (source card vs destination card / product name).
-- 3) product_meat_factory_items: factory cards linked by product_id first, then by resolution.
-- 4) product_edit_audit: who/when/old → new for name, price, barcode, category, pack weight.
-- 5) product_name_aliases(): previous product names (for Bostta sheets after a rename).
-- 6) product_rename_factory_check(): save-time warning in the product form.
-- No product or inventory item is renamed. No stock is touched.

-- ── 0. backup / report table (not exposed through the Data API) ─────────────
CREATE SCHEMA IF NOT EXISTS bk_20261126_rename;
REVOKE ALL ON SCHEMA bk_20261126_rename FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS bk_20261126_rename.mf_finished_product_backfill (
  item_id      uuid PRIMARY KEY,
  item_name    text NOT NULL,
  category     text,
  stock        numeric,
  product_id   uuid,
  product_name text,
  status       text NOT NULL CHECK (status IN ('linked','ambiguous','no_match','product_taken')),
  candidates   text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 1. backfill (uses the CURRENT resolver, before it is replaced below) ──────
WITH fw AS (
  SELECT id FROM public.warehouses WHERE name ILIKE '%مصنع اللحوم%'
),
fi AS (
  SELECT i.*
    FROM public.inventory_items i
   WHERE i.warehouse_id IN (SELECT id FROM fw)
     AND i.is_active = true
     AND i.product_id IS NULL
     AND btrim(COALESCE(i.category, '')) IN ('meat_finished', 'منتج تام مصنع اللحوم', 'منتج تام')
),
cand AS (
  SELECT fi.id AS item_id, c.pid
    FROM fi
    CROSS JOIN LATERAL (
      SELECT d.product_id AS pid
        FROM public.inventory_items d
       WHERE d.id = public.resolve_inventory_transfer_destination(fi.id, '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid)
      UNION
      SELECT p.id FROM public.products p
       WHERE public.canonical_wh_item_name(p.name) = public.canonical_wh_item_name(fi.name)
      UNION
      SELECT d.product_id FROM public.inventory_items d
       WHERE d.warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid
         AND d.is_active = true
         AND public.canonical_wh_item_name(d.name) = public.canonical_wh_item_name(fi.name)
    ) c
   WHERE c.pid IS NOT NULL
),
agg AS (
  SELECT fi.id AS item_id, fi.name, fi.category, fi.stock, fi.warehouse_id,
         array_agg(DISTINCT c.pid) FILTER (WHERE c.pid IS NOT NULL) AS pids
    FROM fi LEFT JOIN cand c ON c.item_id = fi.id
   GROUP BY fi.id, fi.name, fi.category, fi.stock, fi.warehouse_id
),
decided AS (
  SELECT a.*,
         CASE
           WHEN COALESCE(array_length(a.pids, 1), 0) = 0 THEN 'no_match'
           WHEN array_length(a.pids, 1) > 1 THEN 'ambiguous'
           WHEN EXISTS (SELECT 1 FROM public.inventory_items x
                         WHERE x.warehouse_id = a.warehouse_id AND x.product_id = a.pids[1]) THEN 'product_taken'
           WHEN (SELECT count(*) FROM agg b
                  WHERE b.warehouse_id = a.warehouse_id AND array_length(b.pids, 1) = 1
                    AND b.pids[1] = a.pids[1]) > 1 THEN 'ambiguous'
           ELSE 'linked'
         END AS status
    FROM agg a
)
INSERT INTO bk_20261126_rename.mf_finished_product_backfill
  (item_id, item_name, category, stock, product_id, product_name, status, candidates)
SELECT d.item_id, d.name, d.category, d.stock,
       CASE WHEN d.status = 'linked' THEN d.pids[1] END,
       CASE WHEN d.status = 'linked' THEN (SELECT p.name FROM public.products p WHERE p.id = d.pids[1]) END,
       d.status,
       COALESCE((SELECT array_agg(p.name || ' (' || p.id || ')' ORDER BY p.name)
                   FROM public.products p WHERE p.id = ANY (d.pids)), ARRAY[]::text[])
  FROM decided d
ON CONFLICT (item_id) DO NOTHING;

UPDATE public.inventory_items i
   SET product_id = b.product_id
  FROM bk_20261126_rename.mf_finished_product_backfill b
 WHERE b.item_id = i.id
   AND b.status = 'linked'
   AND i.product_id IS NULL;

-- ── 2. transfer destination resolver ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_inventory_transfer_destination(
  p_source_item_id uuid,
  p_destination_warehouse_id uuid
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_source public.inventory_items%ROWTYPE;
  v_dest uuid;
  v_key text;
BEGIN
  SELECT * INTO v_source FROM public.inventory_items WHERE id = p_source_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- (a) same product card
  IF v_source.product_id IS NOT NULL THEN
    SELECT id INTO v_dest
      FROM public.inventory_items
     WHERE warehouse_id = p_destination_warehouse_id
       AND product_id = v_source.product_id
       AND is_active = true
     ORDER BY updated_at DESC
     LIMIT 1;
    IF v_dest IS NOT NULL THEN RETURN v_dest; END IF;
  END IF;

  -- (b) item code / barcode
  IF NULLIF(btrim(v_source.item_code), '') IS NOT NULL THEN
    SELECT i.id INTO v_dest
      FROM public.inventory_items i
      LEFT JOIN public.products p ON p.id = i.product_id
     WHERE i.warehouse_id = p_destination_warehouse_id
       AND i.is_active = true
       AND (i.item_code = v_source.item_code OR p.barcode = v_source.item_code)
     ORDER BY (i.product_id IS NOT NULL) DESC, i.updated_at DESC
     LIMIT 1;
    IF v_dest IS NOT NULL THEN RETURN v_dest; END IF;
  END IF;

  -- (c) canonical name on both sides (strips «نعام/نعامه», unifies spelling and aliases)
  v_key := public.canonical_wh_item_name(v_source.name);
  IF v_key IS NULL OR v_key = '' THEN RETURN NULL; END IF;

  SELECT i.id INTO v_dest
    FROM public.inventory_items i
    LEFT JOIN public.products p ON p.id = i.product_id
   WHERE i.warehouse_id = p_destination_warehouse_id
     AND i.is_active = true
     AND (public.canonical_wh_item_name(i.name) = v_key
          OR public.canonical_wh_item_name(p.name) = v_key)
   ORDER BY (public.canonical_wh_item_name(i.name) = v_key) DESC,
            (i.product_id IS NOT NULL) DESC,
            i.updated_at DESC
   LIMIT 1;

  RETURN v_dest;
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_inventory_transfer_destination(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_inventory_transfer_destination(uuid, uuid) TO service_role;

-- ── 3. factory link of a product ─────────────────────────────────────────────
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
   WHERE fw.name ILIKE '%مصنع اللحوم%'
     AND fi.is_active = true
     AND (
       fi.product_id = p_product_id
       OR (fi.product_id IS NULL AND EXISTS (
             SELECT 1 FROM public.inventory_items d
              WHERE d.id = public.resolve_inventory_transfer_destination(
                             fi.id, '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid)
                AND d.product_id = p_product_id))
     );
$fn$;

REVOKE ALL ON FUNCTION public.product_meat_factory_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_meat_factory_items(uuid) TO authenticated, service_role;

-- ── 4. product edit audit ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_edit_audit (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  field       text NOT NULL CHECK (field IN ('name','price','barcode','category','pack_weight_kg')),
  old_value   text,
  new_value   text,
  changed_by  uuid,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_edit_audit_product_idx ON public.product_edit_audit (product_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS product_edit_audit_name_idx ON public.product_edit_audit (field) WHERE field = 'name';

COMMENT ON TABLE public.product_edit_audit IS
  'سجل تعديل المنتجات: الاسم والسعر والباركود والفئة ووزن العبوة (القيمة القديمة ← الجديدة، من ومتى). يُكتب من التريجر فقط.';

ALTER TABLE public.product_edit_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_edit_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_edit_audit TO authenticated;
GRANT ALL ON public.product_edit_audit TO service_role;

DROP POLICY IF EXISTS product_edit_audit_read ON public.product_edit_audit;
CREATE POLICY product_edit_audit_read ON public.product_edit_audit
  FOR SELECT TO authenticated
  USING (public.has_any_role((SELECT auth.uid()),
         ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.log_product_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO public.product_edit_audit (product_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'name', OLD.name, NEW.name, v_uid);
  END IF;
  IF NEW.price IS DISTINCT FROM OLD.price THEN
    INSERT INTO public.product_edit_audit (product_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'price', OLD.price::text, NEW.price::text, v_uid);
  END IF;
  IF NEW.barcode IS DISTINCT FROM OLD.barcode THEN
    INSERT INTO public.product_edit_audit (product_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'barcode', OLD.barcode, NEW.barcode, v_uid);
  END IF;
  IF NEW.category IS DISTINCT FROM OLD.category THEN
    INSERT INTO public.product_edit_audit (product_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'category', OLD.category, NEW.category, v_uid);
  END IF;
  IF NEW.pack_weight_kg IS DISTINCT FROM OLD.pack_weight_kg THEN
    INSERT INTO public.product_edit_audit (product_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'pack_weight_kg', OLD.pack_weight_kg::text, NEW.pack_weight_kg::text, v_uid);
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.log_product_edit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_log_product_edit ON public.products;
CREATE TRIGGER trg_zz_log_product_edit
  AFTER UPDATE OF name, price, barcode, category, pack_weight_kg ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_product_edit();

-- ── 5. previous names (Bostta sheets keep matching after a rename) ────────────
CREATE OR REPLACE FUNCTION public.product_name_aliases()
RETURNS TABLE(product_id uuid, old_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT DISTINCT a.product_id, btrim(a.old_value)
    FROM public.product_edit_audit a
    JOIN public.products p ON p.id = a.product_id
   WHERE a.field = 'name'
     AND NULLIF(btrim(COALESCE(a.old_value, '')), '') IS NOT NULL
     AND public.normalize_ar_name(btrim(a.old_value)) <> public.normalize_ar_name(btrim(p.name))
     AND (SELECT auth.uid()) IS NOT NULL;
$fn$;

REVOKE ALL ON FUNCTION public.product_name_aliases() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_name_aliases() TO authenticated, service_role;

-- ── 6. save-time check for the product form ──────────────────────────────────
-- Returns which meat-factory finished cards feed this product today and whether they would
-- still feed it after renaming the product to p_new_name. Cards linked by product_id are
-- always kept; cards linked only by name are kept when their canonical name still matches
-- the main-warehouse card or the new product name.
CREATE OR REPLACE FUNCTION public.product_rename_factory_check(p_product_id uuid, p_new_name text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_main constant uuid := '5ec781b5-685b-4806-b59a-83a79ea5662c';
  v_by_id text[];
  v_kept text[];
  v_lost text[];
  v_processed boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT btrim(COALESCE(category, '')) = 'لحوم مصنعة' INTO v_processed
    FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;

  SELECT COALESCE(array_agg(fi.name ORDER BY fi.name), ARRAY[]::text[]) INTO v_by_id
    FROM public.inventory_items fi JOIN public.warehouses fw ON fw.id = fi.warehouse_id
   WHERE fw.name ILIKE '%مصنع اللحوم%' AND fi.is_active AND fi.product_id = p_product_id;

  WITH name_linked AS (
    SELECT fi.name, public.canonical_wh_item_name(fi.name) AS k
      FROM public.inventory_items fi JOIN public.warehouses fw ON fw.id = fi.warehouse_id
     WHERE fw.name ILIKE '%مصنع اللحوم%' AND fi.is_active AND fi.product_id IS NULL
       AND EXISTS (SELECT 1 FROM public.inventory_items d
                    WHERE d.id = public.resolve_inventory_transfer_destination(fi.id, v_main)
                      AND d.product_id = p_product_id)
  )
  SELECT COALESCE(array_agg(n.name ORDER BY n.name) FILTER (WHERE kept), ARRAY[]::text[]),
         COALESCE(array_agg(n.name ORDER BY n.name) FILTER (WHERE NOT kept), ARRAY[]::text[])
    INTO v_kept, v_lost
    FROM (
      SELECT nl.name,
             (public.canonical_wh_item_name(p_new_name) = nl.k
              OR EXISTS (SELECT 1 FROM public.inventory_items d
                          WHERE d.warehouse_id = v_main AND d.is_active
                            AND d.product_id = p_product_id
                            AND public.canonical_wh_item_name(d.name) = nl.k)) AS kept
        FROM name_linked nl
    ) n;

  RETURN jsonb_build_object(
    'is_processed', COALESCE(v_processed, false),
    'linked_by_id', to_jsonb(v_by_id),
    'name_linked_kept', to_jsonb(v_kept),
    'name_linked_lost', to_jsonb(v_lost),
    'will_be_unlinked', COALESCE(v_processed, false)
                        AND COALESCE(array_length(v_by_id, 1), 0) = 0
                        AND COALESCE(array_length(v_kept, 1), 0) = 0
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.product_rename_factory_check(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_rename_factory_check(uuid, text) TO authenticated, service_role;
