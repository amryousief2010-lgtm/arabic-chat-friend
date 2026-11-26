-- Egex counts half-kilo trays, the app counts kg.
-- On 2026-10-02..07, 16 STORE documents were posted with Egex tray counts as kg
-- (e.g. 200 trays of كفتة posted as 200 kg instead of 100 kg). They were corrected
-- with additive KGFIX reversal movements on 2026-10-08. This migration stops it
-- from happening again:
--   1. egex_item_unit_map + egex_units_to_kg(): one place that says what an Egex unit is.
--   2. inventory_egex_staging_compare() now compares in kg (Egex units x kg per unit).
--   3. Guards for store-document postings:
--      a. an Egex/store document number can be posted once only (egex_document_postings);
--      b. store-document lines for tray items must carry package_count/package_weight_kg,
--         and a line whose kg equals its tray count is flagged (warning by default,
--         blocking when app.egex_kg_guard = 'strict').
-- Additive only: no data is changed or deleted, no trigger is disabled.

-- 1. Unit map --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.egex_item_unit_map (
  egex_item_name text PRIMARY KEY,
  app_item_name  text NOT NULL,
  egex_unit      text NOT NULL CHECK (egex_unit IN ('tray', 'kg', 'piece', 'pack')),
  kg_per_unit    numeric NOT NULL CHECK (kg_per_unit > 0),
  confirmed_by   text,
  notes          text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.egex_item_unit_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS egex_item_unit_map_read ON public.egex_item_unit_map;
CREATE POLICY egex_item_unit_map_read ON public.egex_item_unit_map
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS egex_item_unit_map_write ON public.egex_item_unit_map;
CREATE POLICY egex_item_unit_map_write ON public.egex_item_unit_map
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'general_manager'::public.app_role)
      OR public.has_role(auth.uid(), 'executive_manager'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'general_manager'::public.app_role)
      OR public.has_role(auth.uid(), 'executive_manager'::public.app_role));

-- Evidence: Egex BUY lines carry weight = qty x 0.5 for tray items; warehouse keeper
-- أحمد الجمل confirmed 2026-10-08: «عدد العلب نص كيلو». دهن / لحمة نعام فرم / شغت are kg.
INSERT INTO public.egex_item_unit_map (egex_item_name, app_item_name, egex_unit, kg_per_unit, confirmed_by, notes) VALUES
  ('استيك', 'استيك', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('اسكالوب', 'اسكالوب', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('برجر', 'برجر', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('تليبيانكو', 'تربيانكو', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('حواوشي', 'حواوشي', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('رقاب', 'رقاب', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('سجق', 'سجق', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('شرائح رول نعام', 'رول', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('شيش كباب', 'شيش', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('كباب', 'قطع كباب', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('فراشة', 'فراشة', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('قطعية دبوس', 'قطعية الدبوس', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('قلب', 'قلب', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('قوانص', 'قوانص', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('كبدة', 'كبدة', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('كفتة', 'كفتة', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('كفتة ارز', 'كفتة الرز', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('كوارع', 'كوارع', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('لحم مشفي', 'لحم قطع', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('مفروم', 'مفروم', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('ممبار نعام', 'ممبار', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('موزة', 'موزة', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('نخاع', 'نخاع', 'tray', 0.5, 'أحمد الجمل 2026-10-08', NULL),
  ('دهن', 'دهن النعام', 'kg', 1, 'Egex weight = qty', NULL),
  ('لحمة نعام فرم', 'فرم نعام', 'kg', 1, 'Egex weight = qty', NULL),
  ('شغت', 'شغت نعام', 'kg', 1, 'Egex weight = qty (mostly)', 'BUY line with qty 2 / weight 24 contradicts — review'),
  ('دبوس بالعظم', 'دبوس بالعظم', 'piece', 6, 'Egex BUY weight 30 / 5 pieces', 'confirm before posting'),
  ('شاورما', 'شاورما', 'pack', 0.33, 'Egex BUY weight 12.5 / 38 packs', 'confirm before posting')
ON CONFLICT (egex_item_name) DO NOTHING;

-- Egex weight wins when present; otherwise units x kg_per_unit; otherwise the app pack weight.
CREATE OR REPLACE FUNCTION public.egex_units_to_kg(p_egex_item text, p_qty numeric, p_weight numeric DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_qty IS NULL THEN NULL
    WHEN p_weight IS NOT NULL AND p_weight > 0 THEN sign(p_qty) * p_weight
    ELSE p_qty * COALESCE(
      (SELECT m.kg_per_unit FROM public.egex_item_unit_map m WHERE m.egex_item_name = btrim(p_egex_item)),
      public.default_pack_weight_kg(p_egex_item)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.egex_units_to_kg(text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.egex_units_to_kg(text, numeric, numeric) TO authenticated, service_role;

-- 2. Compare in kg ---------------------------------------------------------
-- Same signature and the same "table missing" behaviour as before.
-- egex_qty is now kg; the tray count and the factor are shown in note.
CREATE OR REPLACE FUNCTION public.inventory_egex_staging_compare()
RETURNS TABLE(
  store_key text,
  item_key text,
  app_qty numeric,
  egex_qty numeric,
  note text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_main uuid := '5ec781b5-685b-4806-b59a-83a79ea5662c';
BEGIN
  IF v_uid IS NOT NULL AND NOT (
    public.has_role(v_uid, 'general_manager'::public.app_role)
    OR public.has_role(v_uid, 'executive_manager'::public.app_role)
    OR public.has_role(v_uid, 'warehouse_supervisor'::public.app_role)
    OR public.has_role(v_uid, 'accountant'::public.app_role)
    OR public.has_role(v_uid, 'financial_manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF to_regclass('public.egex_sync_staging') IS NULL THEN
    store_key := NULL; item_key := NULL; app_qty := NULL; egex_qty := NULL;
    note := 'جدول egex_sync_staging غير موجود. المقارنة تُفعَّل عند وجود الجدول وحتى إيقاف إيجكس.';
    RETURN NEXT;
    RETURN;
  END IF;

  IF (SELECT count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'egex_sync_staging'
         AND c.column_name IN ('source_table', 'egex_store_id', 'item_name', 'qty')) < 4 THEN
    store_key := NULL; item_key := NULL; app_qty := NULL; egex_qty := NULL;
    note := 'جدول egex_sync_staging موجود لكن أعمدة المخزن/الصنف/الكمية غير معروفة. لا تُخترع بيانات.';
    RETURN NEXT;
    RETURN;
  END IF;

  RETURN QUERY EXECUTE $q$
    WITH bal AS (
      SELECT e.egex_store_id, btrim(e.item_name) AS egex_item, sum(e.qty) AS units
        FROM public.egex_sync_staging e
       WHERE e.source_table = 'Store'
         AND NOT COALESCE(e.is_deleted, false)
       GROUP BY 1, 2
    )
    SELECT b.egex_store_id::text,
           COALESCE(m.app_item_name, b.egex_item),
           CASE WHEN b.egex_store_id = 1 THEN i.stock END,
           public.egex_units_to_kg(b.egex_item, b.units, NULL),
           format('Egex %s %s × %s كجم%s',
                  b.units,
                  COALESCE(m.egex_unit, 'tray?'),
                  COALESCE(m.kg_per_unit, public.default_pack_weight_kg(b.egex_item)),
                  CASE WHEN m.egex_item_name IS NULL THEN ' — الصنف غير موجود في egex_item_unit_map' ELSE '' END)
      FROM bal b
      LEFT JOIN public.egex_item_unit_map m ON m.egex_item_name = b.egex_item
      LEFT JOIN public.inventory_items i
        ON i.warehouse_id = $1 AND btrim(i.name) = COALESCE(m.app_item_name, b.egex_item)
     WHERE b.units <> 0 OR i.stock <> 0
     LIMIT 5000
  $q$ USING v_main;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_egex_staging_compare() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_egex_staging_compare() TO authenticated, service_role;

-- 3a. One posting per Egex/store document ----------------------------------
CREATE TABLE IF NOT EXISTS public.egex_document_postings (
  doc_no        text NOT NULL,           -- store/Egex document number, e.g. '212' or 'BUY-116'
  doc_kind      text NOT NULL,           -- 'store_document', 'store_zodex_main_to_agouza', ...
  coc_reference text NOT NULL,           -- e.g. STORE-20261002-212
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_kind, doc_no)
);
ALTER TABLE public.egex_document_postings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS egex_document_postings_read ON public.egex_document_postings;
CREATE POLICY egex_document_postings_read ON public.egex_document_postings
  FOR SELECT TO authenticated USING (true);

-- Rows that need a human look (kg == trays, missing package data, ...).
CREATE TABLE IF NOT EXISTS public.inventory_unit_review_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_ref text,
  item_id      uuid,
  quantity     numeric,
  package_count numeric,
  pack_weight_kg numeric,
  issue        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
ALTER TABLE public.inventory_unit_review_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_unit_review_queue_read ON public.inventory_unit_review_queue;
CREATE POLICY inventory_unit_review_queue_read ON public.inventory_unit_review_queue
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.guard_store_document_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doc text;
  v_existing text;
  v_pw numeric;
  v_strict boolean := COALESCE(current_setting('app.egex_kg_guard', true), '') = 'strict';
  v_issue text;
BEGIN
  -- Only store/Egex document postings. Corrections (source_type 'reversal') are exempt.
  IF COALESCE(NEW.reference, '') !~ '^STORE-[0-9]{8}-[0-9]+$'
     OR COALESCE(NEW.source_type, '') = 'reversal' THEN
    RETURN NEW;
  END IF;

  -- a. the same document number cannot be posted under two different references.
  v_doc := substring(NEW.reference from '([0-9]+)$');
  INSERT INTO public.egex_document_postings (doc_no, doc_kind, coc_reference)
  VALUES (v_doc, COALESCE(NEW.reference_type, 'store_document'), NEW.reference)
  ON CONFLICT (doc_kind, doc_no) DO NOTHING;
  SELECT coc_reference INTO v_existing
    FROM public.egex_document_postings
   WHERE doc_kind = COALESCE(NEW.reference_type, 'store_document') AND doc_no = v_doc;
  IF v_existing IS DISTINCT FROM NEW.reference THEN
    RAISE EXCEPTION 'EGEX_DOC_ALREADY_POSTED: المستند % مسجل بالفعل كـ %', v_doc, v_existing;
  END IF;

  -- b. kg vs trays.
  SELECT pack_weight_kg INTO v_pw FROM public.inventory_items WHERE id = NEW.item_id;
  IF COALESCE(v_pw, 1) < 1 THEN
    IF NEW.package_count IS NULL THEN
      v_issue := 'PACKAGE_COUNT_REQUIRED: صنف بالعلبة بدون عدد علب — الكمية يجب أن تكون كجم = علب × وزن العلبة';
    ELSIF abs(abs(NEW.quantity) - NEW.package_count) < 0.0001 THEN
      v_issue := 'KG_EQUALS_TRAYS: الكمية بالكجم تساوي عدد العلب — غالباً تم تسجيل العلب ككجم';
    ELSIF abs(abs(NEW.quantity) - NEW.package_count * COALESCE(NEW.package_weight_kg, v_pw)) > 0.01 THEN
      v_issue := 'KG_PACK_MISMATCH: الكمية لا تساوي علب × وزن العلبة';
    END IF;
  END IF;

  IF v_issue IS NOT NULL THEN
    INSERT INTO public.inventory_unit_review_queue (movement_ref, item_id, quantity, package_count, pack_weight_kg, issue)
    VALUES (NEW.reference, NEW.item_id, NEW.quantity, NEW.package_count, v_pw, v_issue);
    IF v_strict THEN
      RAISE EXCEPTION '%', v_issue;
    END IF;
    RAISE WARNING '% (ref %)', v_issue, NEW.reference;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_store_document_movement ON public.inventory_movements;
CREATE TRIGGER trg_guard_store_document_movement
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.guard_store_document_movement();

-- Backfill the posting register from what is already posted (no movement is changed).
INSERT INTO public.egex_document_postings (doc_no, doc_kind, coc_reference, first_seen_at)
SELECT DISTINCT ON (COALESCE(reference_type, 'store_document'), substring(reference from '([0-9]+)$'))
       substring(reference from '([0-9]+)$'), COALESCE(reference_type, 'store_document'), reference, created_at
  FROM public.inventory_movements
 WHERE reference ~ '^STORE-[0-9]{8}-[0-9]+$'
 ORDER BY COALESCE(reference_type, 'store_document'), substring(reference from '([0-9]+)$'), created_at
ON CONFLICT DO NOTHING;
