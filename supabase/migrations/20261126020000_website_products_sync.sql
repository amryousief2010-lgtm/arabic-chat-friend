-- =====================================================================
-- منتجات الموقع (capitalostrich.com / ووكومرس) ↔ منتجات وعروض coceg
-- طلب م. عمرو (25/11/2026): شاشة لـ م. آلاء (sales_manager) والمدير العام والمدير التنفيذي
-- تعرض كل منتجات الموقع بجانب منتجات وعروض coceg، وتتم منها المطابقة والإضافة والأسعار
-- في الاتجاهين، مع اختيار الاتجاه لكل بند وبدون أي استبدال تلقائي صامت.
--
-- قواعد ثابتة:
--   * الصلاحية = website_inbox_can_manage() (SM / GM / EM فقط).
--   * كل كتابة تُسجَّل في woo_sync_log (من / ماذا / قبل / بعد).
--   * الكتابة على الموقع تتم فقط من دالة الحافة woo-catalog-sync (مفاتيح REST في الأسرار)،
--     وتُسجَّل هنا عبر woo_sync_log_write (service_role فقط).
--   * لا يُخترع باركود. منتج يُستورد من الموقع يخضع لقاعدة المنتج (trg_01_products_required_fields):
--     باركود 13 رقماً أو «الكود تحت التسجيل»، تكلفة > 0، وزن عبوة > 0، ويبدأ غير نشط.
--   * العروض: لا يُسحب سعر عرض من الموقع (سعر العرض في coceg مرتبط بمكوناته)، ولا يُلمس shipping_cost
--     إطلاقاً، وكل عرض يُربط بمنتج واحد فقط على الموقع (لا دمج هوية عرضين).
-- يعتمد على 20261126010000_website_orders_inbox.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) نسخة منتجات الموقع (للقراءة) — تُحدَّث من Store API العامة
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.woo_site_products (
  woo_product_id   bigint      NOT NULL,
  woo_variation_id bigint      NOT NULL DEFAULT 0,
  name             text        NOT NULL,
  sku              text,
  type             text,
  price            numeric(12,2),
  regular_price    numeric(12,2),
  sale_price       numeric(12,2),
  on_sale          boolean     NOT NULL DEFAULT false,
  is_in_stock      boolean,
  permalink        text,
  image_url        text,
  categories       text[]      NOT NULL DEFAULT '{}',
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  removed_at       timestamptz,
  PRIMARY KEY (woo_product_id, woo_variation_id)
);

COMMENT ON TABLE public.woo_site_products IS
  'نسخة من منتجات capitalostrich.com المنشورة (Store API العامة). removed_at = اختفى من الموقع في آخر تحديث.';

ALTER TABLE public.woo_site_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS woo_site_products_select ON public.woo_site_products;
CREATE POLICY woo_site_products_select ON public.woo_site_products
  FOR SELECT TO authenticated USING (public.website_inbox_can_manage());
REVOKE ALL ON public.woo_site_products FROM anon;
GRANT SELECT ON public.woo_site_products TO authenticated;

-- ---------------------------------------------------------------------
-- 2) سجل المزامنة (من / ماذا / قبل / بعد)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.woo_sync_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor            uuid        REFERENCES auth.users(id),
  action           text        NOT NULL CHECK (action IN (
                     'refresh','map','unmap','import_to_coc','pull_price','push_create','push_update')),
  direction        text        CHECK (direction IN ('site_to_coc','coc_to_site')),
  woo_product_id   bigint,
  woo_variation_id bigint,
  product_id       uuid,
  offer_box_id     uuid,
  before           jsonb,
  after            jsonb,
  status           text        NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','failed')),
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS woo_sync_log_created_idx ON public.woo_sync_log (created_at DESC);
CREATE INDEX IF NOT EXISTS woo_sync_log_woo_idx ON public.woo_sync_log (woo_product_id);

ALTER TABLE public.woo_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS woo_sync_log_select ON public.woo_sync_log;
CREATE POLICY woo_sync_log_select ON public.woo_sync_log
  FOR SELECT TO authenticated USING (public.website_inbox_can_manage());
REVOKE ALL ON public.woo_sync_log FROM anon;
GRANT SELECT ON public.woo_sync_log TO authenticated;

-- ---------------------------------------------------------------------
-- 3) هوية العرض: كل عرض يُربط بمنتج واحد فقط على الموقع
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS woo_product_map_offer_box_uniq
  ON public.woo_product_map (offer_box_id) WHERE offer_box_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4) تحديث النسخة (service_role فقط — تستدعيها woo-catalog-sync)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.woo_site_products_refresh(_items jsonb, _complete boolean, _actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_upserted int := 0;
  v_removed int := 0;
  v_new int := 0;
BEGIN
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN RAISE EXCEPTION 'WOO_BAD_INPUT'; END IF;

  SELECT count(*) INTO v_new
  FROM jsonb_array_elements(_items) e
  WHERE NOT EXISTS (
    SELECT 1 FROM public.woo_site_products s
    WHERE s.woo_product_id = (e->>'woo_product_id')::bigint
      AND s.woo_variation_id = coalesce((e->>'woo_variation_id')::bigint, 0));

  INSERT INTO public.woo_site_products AS s (
    woo_product_id, woo_variation_id, name, sku, type, price, regular_price, sale_price,
    on_sale, is_in_stock, permalink, image_url, categories, fetched_at, removed_at)
  SELECT (e->>'woo_product_id')::bigint, coalesce((e->>'woo_variation_id')::bigint, 0),
         coalesce(nullif(btrim(e->>'name'), ''), 'بدون اسم'), nullif(btrim(e->>'sku'), ''), e->>'type',
         (e->>'price')::numeric, (e->>'regular_price')::numeric, (e->>'sale_price')::numeric,
         coalesce((e->>'on_sale')::boolean, false), (e->>'is_in_stock')::boolean,
         e->>'permalink', e->>'image_url',
         coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(e->'categories', '[]'::jsonb))), '{}'),
         v_now, NULL
  FROM jsonb_array_elements(_items) e
  WHERE (e->>'woo_product_id') ~ '^[0-9]+$'
  ON CONFLICT (woo_product_id, woo_variation_id) DO UPDATE SET
    name = EXCLUDED.name, sku = EXCLUDED.sku, type = EXCLUDED.type, price = EXCLUDED.price,
    regular_price = EXCLUDED.regular_price, sale_price = EXCLUDED.sale_price, on_sale = EXCLUDED.on_sale,
    is_in_stock = EXCLUDED.is_in_stock, permalink = EXCLUDED.permalink, image_url = EXCLUDED.image_url,
    categories = EXCLUDED.categories, fetched_at = v_now, removed_at = NULL;
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  IF coalesce(_complete, false) THEN
    UPDATE public.woo_site_products SET removed_at = v_now
    WHERE removed_at IS NULL AND fetched_at < v_now;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  INSERT INTO public.woo_sync_log (actor, action, after)
  VALUES (_actor, 'refresh', jsonb_build_object('upserted', v_upserted, 'new', v_new, 'removed', v_removed, 'complete', coalesce(_complete, false)));

  RETURN jsonb_build_object('upserted', v_upserted, 'new', v_new, 'removed', v_removed);
END $$;

REVOKE ALL ON FUNCTION public.woo_site_products_refresh(jsonb, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.woo_site_products_refresh(jsonb, boolean, uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 5) سجل الكتابة على الموقع (service_role فقط)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.woo_sync_log_write(
  _actor uuid, _action text, _direction text, _woo_product_id bigint, _woo_variation_id bigint,
  _product_id uuid, _offer_box_id uuid, _before jsonb, _after jsonb, _status text, _error text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.woo_sync_log (actor, action, direction, woo_product_id, woo_variation_id,
    product_id, offer_box_id, before, after, status, error)
  VALUES (_actor, _action, _direction, _woo_product_id, _woo_variation_id,
    _product_id, _offer_box_id, _before, _after, coalesce(_status, 'applied'), left(_error, 500))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.woo_sync_log_write(uuid, text, text, bigint, bigint, uuid, uuid, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.woo_sync_log_write(uuid, text, text, bigint, bigint, uuid, uuid, jsonb, jsonb, text, text) TO service_role;

-- ---------------------------------------------------------------------
-- 6) المطابقة / فك المطابقة (مع سجل)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.woo_catalog_map(
  _woo_product_id bigint, _woo_variation_id bigint, _product_id uuid, _offer_box_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_before jsonb;
  v_name text;
  v_var bigint := coalesce(_woo_variation_id, 0);
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WOO_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _offer_box_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.woo_product_map
    WHERE offer_box_id = _offer_box_id AND (woo_product_id, woo_variation_id) <> (_woo_product_id, v_var)
  ) THEN
    RAISE EXCEPTION 'WOO_BOX_ALREADY_MAPPED';
  END IF;

  SELECT to_jsonb(m) - 'mapped_at' INTO v_before FROM public.woo_product_map m
  WHERE woo_product_id = _woo_product_id AND woo_variation_id = v_var;
  SELECT name INTO v_name FROM public.woo_site_products
  WHERE woo_product_id = _woo_product_id AND woo_variation_id = v_var;

  PERFORM public.website_inbox_map_product(_woo_product_id, v_var, _product_id, _offer_box_id, v_name);

  INSERT INTO public.woo_sync_log (actor, action, woo_product_id, woo_variation_id, product_id, offer_box_id, before, after)
  VALUES (auth.uid(), 'map', _woo_product_id, v_var, _product_id, _offer_box_id, v_before,
          jsonb_build_object('product_id', _product_id, 'offer_box_id', _offer_box_id));
END $$;

REVOKE ALL ON FUNCTION public.woo_catalog_map(bigint, bigint, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.woo_catalog_map(bigint, bigint, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.woo_catalog_unmap(_woo_product_id bigint, _woo_variation_id bigint, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_before jsonb; v_var bigint := coalesce(_woo_variation_id, 0);
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WOO_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN RAISE EXCEPTION 'WOO_REASON_REQUIRED'; END IF;
  DELETE FROM public.woo_product_map
  WHERE woo_product_id = _woo_product_id AND woo_variation_id = v_var
  RETURNING to_jsonb(woo_product_map.*) - 'mapped_at' INTO v_before;
  IF v_before IS NULL THEN RAISE EXCEPTION 'WOO_NOT_MAPPED'; END IF;
  INSERT INTO public.woo_sync_log (actor, action, woo_product_id, woo_variation_id, product_id, offer_box_id, before, after)
  VALUES (auth.uid(), 'unmap', _woo_product_id, v_var, (v_before->>'product_id')::uuid, (v_before->>'offer_box_id')::uuid,
          v_before, jsonb_build_object('reason', btrim(_reason)));
END $$;

REVOKE ALL ON FUNCTION public.woo_catalog_unmap(bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.woo_catalog_unmap(bigint, bigint, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 7) سحب سعر منتج من الموقع إلى coceg (بعد معاينة؛ قيم متوقعة لمنع الاستبدال الصامت)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.woo_catalog_pull_price(
  _woo_product_id bigint, _woo_variation_id bigint, _expected_coc_price numeric, _expected_site_price numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_var bigint := coalesce(_woo_variation_id, 0);
  v_map public.woo_product_map;
  v_site numeric;
  v_old numeric;
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WOO_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_map FROM public.woo_product_map WHERE woo_product_id = _woo_product_id AND woo_variation_id = v_var;
  IF NOT FOUND THEN RAISE EXCEPTION 'WOO_NOT_MAPPED'; END IF;
  IF v_map.kind = 'offer_box' THEN RAISE EXCEPTION 'WOO_BOX_PRICE_PULL_BLOCKED'; END IF;

  SELECT price INTO v_site FROM public.woo_site_products
  WHERE woo_product_id = _woo_product_id AND woo_variation_id = v_var AND removed_at IS NULL;
  IF v_site IS NULL OR v_site <= 0 THEN RAISE EXCEPTION 'WOO_SITE_PRICE_MISSING'; END IF;
  IF v_site IS DISTINCT FROM _expected_site_price THEN RAISE EXCEPTION 'WOO_CHANGED_SINCE_PREVIEW'; END IF;

  SELECT price INTO v_old FROM public.products WHERE id = v_map.product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WOO_PRODUCT_NOT_FOUND'; END IF;
  IF v_old IS DISTINCT FROM _expected_coc_price THEN RAISE EXCEPTION 'WOO_CHANGED_SINCE_PREVIEW'; END IF;
  IF v_old = v_site THEN RETURN jsonb_build_object('changed', false, 'price', v_old); END IF;

  UPDATE public.products SET old_price = v_old, price = v_site WHERE id = v_map.product_id;

  INSERT INTO public.woo_sync_log (actor, action, direction, woo_product_id, woo_variation_id, product_id, before, after)
  VALUES (auth.uid(), 'pull_price', 'site_to_coc', _woo_product_id, v_var, v_map.product_id,
          jsonb_build_object('price', v_old), jsonb_build_object('price', v_site));
  RETURN jsonb_build_object('changed', true, 'before', v_old, 'after', v_site);
END $$;

REVOKE ALL ON FUNCTION public.woo_catalog_pull_price(bigint, bigint, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.woo_catalog_pull_price(bigint, bigint, numeric, numeric) TO authenticated;

-- ---------------------------------------------------------------------
-- 8) استيراد منتج من الموقع إلى coceg (قاعدة المنتج + ربط + سجل)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.woo_catalog_import_product(
  _woo_product_id bigint, _woo_variation_id bigint, _name text, _price numeric,
  _cost_price numeric, _pack_weight_kg numeric, _barcode text, _barcode_pending boolean,
  _unit text, _category text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_var bigint := coalesce(_woo_variation_id, 0);
  v_missing text[] := ARRAY[]::text[];
  v_barcode text := nullif(btrim(coalesce(_barcode, '')), '');
  v_id uuid;
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WOO_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.woo_site_products WHERE woo_product_id = _woo_product_id AND woo_variation_id = v_var) THEN
    RAISE EXCEPTION 'WOO_SITE_PRODUCT_NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM public.woo_product_map WHERE woo_product_id = _woo_product_id AND woo_variation_id = v_var) THEN
    RAISE EXCEPTION 'WOO_ALREADY_MAPPED';
  END IF;

  IF nullif(btrim(coalesce(_name, '')), '') IS NULL THEN v_missing := v_missing || 'الاسم'::text; END IF;
  IF coalesce(_price, 0) <= 0 THEN v_missing := v_missing || 'سعر البيع'::text; END IF;
  IF coalesce(_cost_price, 0) <= 0 THEN v_missing := v_missing || 'التكلفة'::text; END IF;
  IF coalesce(_pack_weight_kg, 0) <= 0 THEN v_missing := v_missing || 'وزن العبوة'::text; END IF;
  IF v_barcode IS NULL AND NOT coalesce(_barcode_pending, false) THEN
    v_missing := v_missing || 'الباركود أو «الكود تحت التسجيل»'::text;
  END IF;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'WOO_IMPORT_MISSING: %', array_to_string(v_missing, '، ');
  END IF;
  IF v_barcode IS NOT NULL AND v_barcode !~ '^[0-9]{13}$' THEN RAISE EXCEPTION 'WOO_BARCODE_INVALID'; END IF;
  IF v_barcode IS NOT NULL AND EXISTS (SELECT 1 FROM public.products WHERE barcode = v_barcode) THEN
    RAISE EXCEPTION 'WOO_BARCODE_DUPLICATE';
  END IF;

  -- يبدأ غير نشط؛ التفعيل من شاشة المنتجات حسب قاعدة التفعيل الحالية.
  INSERT INTO public.products (name, price, cost_price, pack_weight_kg, barcode, barcode_pending, unit, category, is_active, stock)
  VALUES (btrim(_name), _price, _cost_price, _pack_weight_kg, v_barcode, v_barcode IS NULL AND coalesce(_barcode_pending, false),
          coalesce(nullif(btrim(coalesce(_unit, '')), ''), 'كيلو'), nullif(btrim(coalesce(_category, '')), ''), false, 0)
  RETURNING id INTO v_id;

  INSERT INTO public.woo_product_map (woo_product_id, woo_variation_id, kind, product_id, woo_name, mapped_by, mapped_at)
  SELECT _woo_product_id, v_var, 'product', v_id, s.name, auth.uid(), now()
  FROM public.woo_site_products s WHERE s.woo_product_id = _woo_product_id AND s.woo_variation_id = v_var;

  INSERT INTO public.woo_sync_log (actor, action, direction, woo_product_id, woo_variation_id, product_id, before, after)
  VALUES (auth.uid(), 'import_to_coc', 'site_to_coc', _woo_product_id, v_var, v_id, NULL,
          jsonb_build_object('name', btrim(_name), 'price', _price, 'cost_price', _cost_price,
            'pack_weight_kg', _pack_weight_kg, 'barcode', v_barcode, 'barcode_pending', v_barcode IS NULL,
            'is_active', false));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.woo_catalog_import_product(bigint, bigint, text, numeric, numeric, numeric, text, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.woo_catalog_import_product(bigint, bigint, text, numeric, numeric, numeric, text, boolean, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 9) استيراد عرض/بوكس من الموقع إلى coceg (م. آلاء تحدد المكونات والشحن)
--    قاعدة العروض الحالية في coceg: سعر العرض = مجموع (سعر المكوّن × الكمية) لغير الهدايا + shipping_cost.
--    سعر الموقع يُعتمد كسعر العرض، ويُرفض الاستيراد إن لم تتطابق المعادلة (لا تعديل صامت لأي رقم).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.woo_catalog_import_box(
  _woo_product_id bigint, _woo_variation_id bigint, _name text, _shipping_cost numeric, _items jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_var bigint := coalesce(_woo_variation_id, 0);
  v_site numeric;
  v_paid numeric;
  v_id uuid;
  v_bad int;
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WOO_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT price INTO v_site FROM public.woo_site_products
  WHERE woo_product_id = _woo_product_id AND woo_variation_id = v_var AND removed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'WOO_SITE_PRODUCT_NOT_FOUND'; END IF;
  IF coalesce(v_site, 0) <= 0 THEN RAISE EXCEPTION 'WOO_SITE_PRICE_MISSING'; END IF;
  IF EXISTS (SELECT 1 FROM public.woo_product_map WHERE woo_product_id = _woo_product_id AND woo_variation_id = v_var) THEN
    RAISE EXCEPTION 'WOO_ALREADY_MAPPED';
  END IF;
  IF nullif(btrim(coalesce(_name, '')), '') IS NULL THEN RAISE EXCEPTION 'WOO_IMPORT_MISSING: اسم العرض'; END IF;
  IF _shipping_cost IS NOT NULL AND _shipping_cost < 0 THEN RAISE EXCEPTION 'WOO_BAD_INPUT'; END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'WOO_IMPORT_MISSING: مكونات العرض';
  END IF;

  SELECT count(*) INTO v_bad FROM jsonb_array_elements(_items) e
  WHERE NOT ((e->>'product_id') ~* '^[0-9a-f-]{36}$')
     OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = (e->>'product_id')::uuid)
     OR coalesce((e->>'quantity')::numeric, 0) <= 0
     OR (NOT coalesce((e->>'is_gift')::boolean, false) AND coalesce((e->>'custom_price')::numeric, -1) < 0);
  IF v_bad > 0 THEN RAISE EXCEPTION 'WOO_BOX_ITEMS_INVALID'; END IF;

  SELECT coalesce(sum((e->>'custom_price')::numeric * (e->>'quantity')::numeric), 0) INTO v_paid
  FROM jsonb_array_elements(_items) e WHERE NOT coalesce((e->>'is_gift')::boolean, false);
  IF v_paid + coalesce(_shipping_cost, 0) <> v_site THEN
    RAISE EXCEPTION 'WOO_BOX_PRICE_MISMATCH: % + % <> %', v_paid, coalesce(_shipping_cost, 0), v_site;
  END IF;

  -- يبدأ غير نشط؛ التفعيل من شاشة صناديق العروض بعد المراجعة.
  INSERT INTO public.offer_boxes (name, offer_price, shipping_cost, is_active, created_by)
  VALUES (btrim(_name), v_site, _shipping_cost, false, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.offer_box_items (offer_box_id, product_id, quantity, custom_price, is_gift)
  SELECT v_id, (e->>'product_id')::uuid, (e->>'quantity')::numeric,
         CASE WHEN coalesce((e->>'is_gift')::boolean, false) THEN 0 ELSE (e->>'custom_price')::numeric END,
         coalesce((e->>'is_gift')::boolean, false)
  FROM jsonb_array_elements(_items) e;

  INSERT INTO public.woo_product_map (woo_product_id, woo_variation_id, kind, offer_box_id, woo_name, mapped_by, mapped_at)
  SELECT _woo_product_id, v_var, 'offer_box', v_id, s.name, auth.uid(), now()
  FROM public.woo_site_products s WHERE s.woo_product_id = _woo_product_id AND s.woo_variation_id = v_var;

  INSERT INTO public.woo_sync_log (actor, action, direction, woo_product_id, woo_variation_id, offer_box_id, before, after)
  VALUES (auth.uid(), 'import_to_coc', 'site_to_coc', _woo_product_id, v_var, v_id, NULL,
          jsonb_build_object('name', btrim(_name), 'offer_price', v_site, 'shipping_cost', _shipping_cost,
            'items', _items, 'is_active', false));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.woo_catalog_import_box(bigint, bigint, text, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.woo_catalog_import_box(bigint, bigint, text, numeric, jsonb) TO authenticated;
