-- =====================================================================
-- منتجات الموقع: صلاحيات الإدارة من الشاشة (طلب م. عمرو 25/11/2026)
-- لـ م. آلاء والمدير العام والمدير التنفيذي فقط (website_inbox_can_manage()):
--   1) صور المنتجات والعروض: رفع صورة لمنتج/عرض بلا صورة أو استبدالها (حاوية تخزين عامة القراءة
--      بحدود حجم ونوع)، مع سجل.
--   2) تعديل سعر منتج في coceg (بقيمة متوقعة لمنع الاستبدال الصامت). سعر العرض لا يُعدَّل مباشرة:
--      يُعدَّل سعر مكوناته المدفوعة ويُعاد حسابه بقاعدة العروض (المكونات المدفوعة + الشحن)، مع بقاء
--      الشحن ضمن السعر وبقاء هوية العرض (نفس العرض ونفس المكونات والكميات).
--   3) تسجيل كتابات الموقع الجديدة (السعر، التخفيض، الظهور، رمز الصنف، الصورة) في woo_sync_log.
-- الطلبات تستخدم سعر coceg وقت الإنشاء؛ تعديل السعر يسري على الطلبات الجديدة فقط.
-- يعتمد على 20261126020000_website_products_sync.sql.
-- =====================================================================

-- 1) صورة العرض
ALTER TABLE public.offer_boxes ADD COLUMN IF NOT EXISTS image_url text;
COMMENT ON COLUMN public.offer_boxes.image_url IS 'صورة العرض (اختيارية) — تُرفع من شاشة منتجات الموقع.';

-- 2) أنواع السجل الجديدة
ALTER TABLE public.woo_sync_log DROP CONSTRAINT IF EXISTS woo_sync_log_action_check;
ALTER TABLE public.woo_sync_log ADD CONSTRAINT woo_sync_log_action_check CHECK (action IN (
  'refresh','map','unmap','import_to_coc','pull_price','push_create','push_update',
  'coc_price','coc_box_price','coc_image',
  'site_price','site_sale','site_visibility','site_sku','site_image'));

-- 3) حاوية الصور: قراءة عامة، كتابة لأصحاب الصلاحية فقط، 2 ميجابايت، JPEG/PNG/WebP
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('website-product-images', 'website-product-images', true, 2097152,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS website_product_images_insert ON storage.objects;
CREATE POLICY website_product_images_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'website-product-images' AND public.website_inbox_can_manage()
              AND (storage.foldername(name))[1] IN ('product','offer_box'));
DROP POLICY IF EXISTS website_product_images_update ON storage.objects;
CREATE POLICY website_product_images_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'website-product-images' AND public.website_inbox_can_manage())
  WITH CHECK (bucket_id = 'website-product-images' AND public.website_inbox_can_manage());
DROP POLICY IF EXISTS website_product_images_delete ON storage.objects;
CREATE POLICY website_product_images_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'website-product-images' AND public.website_inbox_can_manage());

-- 4) ضبط صورة منتج/عرض في coceg (رابط من الحاوية فقط)
CREATE OR REPLACE FUNCTION public.website_set_coc_image(_kind text, _id uuid, _url text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_before text;
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WOO_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _url IS NULL OR _url !~ '^https://[^/]+/storage/v1/object/public/website-product-images/(product|offer_box)/[0-9a-f-]{36}/[A-Za-z0-9._-]+$' THEN
    RAISE EXCEPTION 'WEB_IMAGE_URL_INVALID';
  END IF;
  IF _kind = 'product' THEN
    SELECT image_url INTO v_before FROM public.products WHERE id = _id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WEB_TARGET_NOT_FOUND'; END IF;
    UPDATE public.products SET image_url = _url WHERE id = _id;
  ELSIF _kind = 'offer_box' THEN
    SELECT image_url INTO v_before FROM public.offer_boxes WHERE id = _id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WEB_TARGET_NOT_FOUND'; END IF;
    UPDATE public.offer_boxes SET image_url = _url WHERE id = _id;
  ELSE
    RAISE EXCEPTION 'WEB_MAP_ONE_TARGET';
  END IF;
  INSERT INTO public.woo_sync_log (actor, action, product_id, offer_box_id, before, after)
  VALUES (auth.uid(), 'coc_image',
          CASE WHEN _kind = 'product' THEN _id END, CASE WHEN _kind = 'offer_box' THEN _id END,
          jsonb_build_object('image_url', v_before), jsonb_build_object('image_url', _url));
END $$;

REVOKE ALL ON FUNCTION public.website_set_coc_image(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_set_coc_image(text, uuid, text) TO authenticated;

-- 5) سعر منتج في coceg
CREATE OR REPLACE FUNCTION public.website_set_coc_product_price(_product_id uuid, _price numeric, _expected numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_before numeric;
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WOO_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _price IS NULL OR _price <= 0 OR _price > 1000000 THEN RAISE EXCEPTION 'WEB_PRICE_INVALID'; END IF;
  SELECT price INTO v_before FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_TARGET_NOT_FOUND'; END IF;
  IF v_before IS DISTINCT FROM _expected THEN RAISE EXCEPTION 'WOO_CHANGED_SINCE_PREVIEW'; END IF;
  IF v_before = round(_price, 2) THEN RETURN; END IF;
  UPDATE public.products SET price = round(_price, 2) WHERE id = _product_id;
  INSERT INTO public.woo_sync_log (actor, action, product_id, before, after)
  VALUES (auth.uid(), 'coc_price', _product_id, jsonb_build_object('price', v_before), jsonb_build_object('price', round(_price, 2)));
END $$;

REVOKE ALL ON FUNCTION public.website_set_coc_product_price(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_set_coc_product_price(uuid, numeric, numeric) TO authenticated;

-- 6) سعر عرض في coceg عبر قاعدة العروض:
--    سعر العرض = Σ(سعر المكون المدفوع × الكمية) + الشحن. يُعدَّل سعر المكونات المدفوعة فقط؛
--    الشحن والاسم والمكونات والكميات والهدايا تبقى كما هي.
--    _items = [{"item_id": uuid, "custom_price": numeric}, ...]
CREATE OR REPLACE FUNCTION public.website_set_coc_box_prices(_box_id uuid, _items jsonb, _expected_offer_price numeric)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_box public.offer_boxes%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_paid numeric;
  v_new numeric;
  e jsonb;
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WOO_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'WOO_BOX_ITEMS_INVALID'; END IF;
  SELECT * INTO v_box FROM public.offer_boxes WHERE id = _box_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_TARGET_NOT_FOUND'; END IF;
  IF v_box.offer_price IS DISTINCT FROM _expected_offer_price THEN RAISE EXCEPTION 'WOO_CHANGED_SINCE_PREVIEW'; END IF;

  SELECT jsonb_agg(jsonb_build_object('item_id', id, 'custom_price', custom_price, 'quantity', quantity, 'is_gift', is_gift) ORDER BY created_at)
    INTO v_before FROM public.offer_box_items WHERE offer_box_id = _box_id;

  FOR e IN SELECT * FROM jsonb_array_elements(_items) LOOP
    IF NOT (e ? 'item_id') OR (e->>'custom_price') IS NULL OR (e->>'custom_price')::numeric < 0 THEN
      RAISE EXCEPTION 'WOO_BOX_ITEMS_INVALID';
    END IF;
    UPDATE public.offer_box_items SET custom_price = round((e->>'custom_price')::numeric, 2)
    WHERE id = (e->>'item_id')::uuid AND offer_box_id = _box_id AND NOT coalesce(is_gift, false);
    IF NOT FOUND THEN RAISE EXCEPTION 'WOO_BOX_ITEMS_INVALID'; END IF;
  END LOOP;

  SELECT coalesce(sum(CASE WHEN coalesce(is_gift, false) THEN 0 ELSE coalesce(custom_price, 0) * quantity END), 0)
    INTO v_paid FROM public.offer_box_items WHERE offer_box_id = _box_id;
  v_new := round(v_paid + coalesce(v_box.shipping_cost, 0), 2);
  IF v_new <= 0 OR v_new <= coalesce(v_box.shipping_cost, 0) THEN RAISE EXCEPTION 'WEB_PRICE_INVALID'; END IF;

  UPDATE public.offer_boxes SET offer_price = v_new WHERE id = _box_id;

  SELECT jsonb_agg(jsonb_build_object('item_id', id, 'custom_price', custom_price, 'quantity', quantity, 'is_gift', is_gift) ORDER BY created_at)
    INTO v_after FROM public.offer_box_items WHERE offer_box_id = _box_id;
  INSERT INTO public.woo_sync_log (actor, action, offer_box_id, before, after)
  VALUES (auth.uid(), 'coc_box_price', _box_id,
          jsonb_build_object('offer_price', v_box.offer_price, 'shipping_cost', v_box.shipping_cost, 'items', v_before),
          jsonb_build_object('offer_price', v_new, 'shipping_cost', v_box.shipping_cost, 'items', v_after));
  RETURN v_new;
END $$;

REVOKE ALL ON FUNCTION public.website_set_coc_box_prices(uuid, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_set_coc_box_prices(uuid, jsonb, numeric) TO authenticated;
