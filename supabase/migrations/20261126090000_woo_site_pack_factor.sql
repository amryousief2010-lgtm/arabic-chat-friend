-- =====================================================================
-- وزن عبوة منتج الموقع بوحدة COCEG (طلب م. عمرو 26/11/2026)
-- مثال: «لانشون نعام – 500 جرام» على الموقع بـ 175، و«لانشون» في COCEG بالكيلو بـ 350.
--   site_pack_qty = 0.5 → سعر الموقع = 350 × 0.5 = 175، وطلب 2 عبوة = 1 كجم في COCEG.
-- الوزن على الربط نفسه (woo_product_map)، الافتراضي 1، ولا يُعتمد غيره إلا بتأكيد صريح
-- (site_pack_confirmed_by / _at). العروض (offer_box) وزنها 1 دائماً وتحتفظ بأسعارها.
-- لا تغيير في العنوان أو طريقة التسليم أو cm_ad_attributions.
-- =====================================================================

-- 1) الأعمدة
ALTER TABLE public.woo_product_map
  ADD COLUMN IF NOT EXISTS site_pack_qty          numeric(10,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS site_pack_label        text,
  ADD COLUMN IF NOT EXISTS site_pack_confirmed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS site_pack_confirmed_at timestamptz;

ALTER TABLE public.woo_product_map DROP CONSTRAINT IF EXISTS woo_product_map_site_pack_chk;
ALTER TABLE public.woo_product_map ADD CONSTRAINT woo_product_map_site_pack_chk CHECK (
  site_pack_qty > 0 AND site_pack_qty <= 100
  AND (kind = 'product' OR site_pack_qty = 1)
  AND (site_pack_label IS NULL OR char_length(site_pack_label) <= 40)
);

COMMENT ON COLUMN public.woo_product_map.site_pack_qty IS
  'وزن/كمية عبوة منتج الموقع بوحدة COCEG (مثال 0.5 = عبوة نصف كيلو لمنتج بالكيلو). سعر الموقع = سعر COCEG × القيمة؛ كمية الطلب = عدد العبوات × القيمة.';
COMMENT ON COLUMN public.woo_product_map.site_pack_label IS 'وصف عبوة الموقع كما يظهر للعميل (مثال «500 جم»).';

-- 2) سجل المزامنة: نوع «pack_factor»
ALTER TABLE public.woo_sync_log DROP CONSTRAINT IF EXISTS woo_sync_log_action_check;
ALTER TABLE public.woo_sync_log ADD CONSTRAINT woo_sync_log_action_check CHECK (action = ANY (ARRAY[
  'refresh','map','unmap','import_to_coc','pull_price','push_create','push_update','coc_price','coc_box_price',
  'coc_image','coc_validity','site_price','site_sale','site_visibility','site_sku','site_image','site_validity',
  'site_restore','pack_factor'
]::text[]));

-- 3) تغيير المنتج المربوط يعيد الوزن إلى 1 غير مؤكَّد (حتى لا ينتقل وزن منتج لآخر).
CREATE OR REPLACE FUNCTION public.woo_product_map_reset_pack()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF (NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.offer_box_id IS DISTINCT FROM OLD.offer_box_id OR NEW.kind IS DISTINCT FROM OLD.kind)
     AND NEW.site_pack_qty IS NOT DISTINCT FROM OLD.site_pack_qty
     AND NEW.site_pack_confirmed_at IS NOT DISTINCT FROM OLD.site_pack_confirmed_at THEN
    NEW.site_pack_qty := 1;
    NEW.site_pack_label := NULL;
    NEW.site_pack_confirmed_by := NULL;
    NEW.site_pack_confirmed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS woo_product_map_reset_pack ON public.woo_product_map;
CREATE TRIGGER woo_product_map_reset_pack BEFORE UPDATE ON public.woo_product_map
  FOR EACH ROW EXECUTE FUNCTION public.woo_product_map_reset_pack();

-- 4) تأكيد/تعديل وزن العبوة لربط موجود (معاينة ثم تأكيد؛ 409 منطقي إذا تغيّر منذ المعاينة)
CREATE OR REPLACE FUNCTION public.woo_catalog_set_pack(
  _woo_product_id bigint, _woo_variation_id bigint, _site_pack_qty numeric, _site_pack_label text, _expected_pack_qty numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_var   bigint := coalesce(_woo_variation_id, 0);
  v_map   public.woo_product_map%ROWTYPE;
  v_qty   numeric := round(_site_pack_qty, 3);
  v_label text := nullif(btrim(coalesce(_site_pack_label, '')), '');
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WOO_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 100 THEN RAISE EXCEPTION 'WOO_PACK_QTY_INVALID'; END IF;
  IF v_label IS NOT NULL AND char_length(v_label) > 40 THEN RAISE EXCEPTION 'WOO_PACK_LABEL_TOO_LONG'; END IF;

  SELECT * INTO v_map FROM public.woo_product_map WHERE woo_product_id = _woo_product_id AND woo_variation_id = v_var FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WOO_NOT_MAPPED'; END IF;
  IF v_map.kind = 'offer_box' AND v_qty <> 1 THEN RAISE EXCEPTION 'WOO_PACK_BOX_BLOCKED'; END IF;
  IF _expected_pack_qty IS NOT NULL AND v_map.site_pack_qty IS DISTINCT FROM round(_expected_pack_qty, 3) THEN
    RAISE EXCEPTION 'WOO_CHANGED_SINCE_PREVIEW';
  END IF;

  UPDATE public.woo_product_map
     SET site_pack_qty = v_qty, site_pack_label = v_label,
         site_pack_confirmed_by = auth.uid(), site_pack_confirmed_at = now()
   WHERE woo_product_id = _woo_product_id AND woo_variation_id = v_var;

  INSERT INTO public.woo_sync_log (actor, action, woo_product_id, woo_variation_id, product_id, offer_box_id, before, after)
  VALUES (auth.uid(), 'pack_factor', _woo_product_id, v_var, v_map.product_id, v_map.offer_box_id,
          jsonb_build_object('site_pack_qty', v_map.site_pack_qty, 'site_pack_label', v_map.site_pack_label,
                             'confirmed', v_map.site_pack_confirmed_at IS NOT NULL),
          jsonb_build_object('site_pack_qty', v_qty, 'site_pack_label', v_label, 'confirmed', true));

  RETURN jsonb_build_object('changed', v_map.site_pack_qty IS DISTINCT FROM v_qty OR v_map.site_pack_label IS DISTINCT FROM v_label,
                            'site_pack_qty', v_qty, 'site_pack_label', v_label);
END $$;

REVOKE ALL ON FUNCTION public.woo_catalog_set_pack(bigint, bigint, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.woo_catalog_set_pack(bigint, bigint, numeric, text, numeric) TO authenticated;

-- 5) ربط + وزن العبوة في خطوة واحدة (نافذة الربط)
CREATE OR REPLACE FUNCTION public.woo_catalog_map_with_pack(
  _woo_product_id bigint, _woo_variation_id bigint, _product_id uuid, _offer_box_id uuid,
  _site_pack_qty numeric, _site_pack_label text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_var bigint := coalesce(_woo_variation_id, 0);
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WOO_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _offer_box_id IS NOT NULL AND coalesce(_site_pack_qty, 1) <> 1 THEN RAISE EXCEPTION 'WOO_PACK_BOX_BLOCKED'; END IF;
  PERFORM public.woo_catalog_map(_woo_product_id, v_var, _product_id, _offer_box_id);
  RETURN public.woo_catalog_set_pack(_woo_product_id, v_var, coalesce(_site_pack_qty, 1), _site_pack_label, NULL);
END $$;

REVOKE ALL ON FUNCTION public.woo_catalog_map_with_pack(bigint, bigint, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.woo_catalog_map_with_pack(bigint, bigint, uuid, uuid, numeric, text) TO authenticated;

-- 6) سحب السعر من الموقع: سعر COCEG = سعر عبوة الموقع ÷ وزن العبوة
CREATE OR REPLACE FUNCTION public.woo_catalog_pull_price(_woo_product_id bigint, _woo_variation_id bigint, _expected_coc_price numeric, _expected_site_price numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_var bigint := coalesce(_woo_variation_id, 0);
  v_map public.woo_product_map;
  v_site numeric;
  v_old numeric;
  v_new numeric;
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
  v_new := round(v_site / coalesce(nullif(v_map.site_pack_qty, 0), 1), 2);
  IF v_old = v_new THEN RETURN jsonb_build_object('changed', false, 'price', v_old); END IF;

  UPDATE public.products SET old_price = v_old, price = v_new WHERE id = v_map.product_id;

  INSERT INTO public.woo_sync_log (actor, action, direction, woo_product_id, woo_variation_id, product_id, before, after)
  VALUES (auth.uid(), 'pull_price', 'site_to_coc', _woo_product_id, v_var, v_map.product_id,
          jsonb_build_object('price', v_old),
          jsonb_build_object('price', v_new, 'site_price', v_site, 'site_pack_qty', v_map.site_pack_qty));
  RETURN jsonb_build_object('changed', true, 'before', v_old, 'after', v_new);
END $$;

-- 7) إسناد طلب الموقع: بنود المنتجات بوزن العبوة (العروض كما هي، والعنوان كما هو)
CREATE OR REPLACE FUNCTION public.website_inbox_assign(_inbox_id uuid, _moderator_user_id uuid, _customer_id uuid DEFAULT NULL::uuid, _create_new_customer boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_row        public.website_inbox%ROWTYPE;
  v_mod_name   text;
  v_customer   uuid;
  v_order_id   uuid;
  v_order_no   text;
  v_line       jsonb;
  v_map        public.woo_product_map%ROWTYPE;
  v_unmapped   jsonb := '[]'::jsonb;
  v_qty        numeric;
  v_unit       numeric;
  v_box        public.offer_boxes%ROWTYPE;
  v_boxes      jsonb := '[]'::jsonb;
  v_has_box    boolean := false;
  v_fee        numeric := 0;
  v_notes      text;
  v_total      numeric;
  v_pack       numeric;
  v_cqty       numeric;
  v_packs      jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WEB_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_row FROM public.website_inbox WHERE id = _inbox_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_NOT_FOUND'; END IF;
  IF v_row.status <> 'new' THEN RAISE EXCEPTION 'WEB_NOT_NEW'; END IF;

  IF _moderator_user_id IS NULL OR NOT public.has_role(_moderator_user_id, 'sales_moderator'::public.app_role) THEN
    RAISE EXCEPTION 'WEB_INVALID_MODERATOR';
  END IF;
  SELECT full_name INTO v_mod_name FROM public.profile_directory WHERE id = _moderator_user_id;

  -- تسجيل عميل بدون طلب: إسناد للمتابعة فقط.
  IF v_row.kind = 'registration' THEN
    UPDATE public.website_inbox SET status = 'assigned', assigned_moderator_user_id = _moderator_user_id,
      assigned_customer_id = _customer_id, assigned_by = auth.uid(), assigned_at = now(), updated_at = now()
    WHERE id = v_row.id;
    INSERT INTO public.notifications (title, description, type, target_user_id)
    VALUES ('🌐 عميل جديد من الموقع',
            'تم إسناد عميل سجّل على الموقع إليكِ للمتابعة: ' || coalesce(v_row.customer_name, ''),
            'website_registration_assigned', _moderator_user_id);
    INSERT INTO public.website_inbox_audit (inbox_id, action, actor, details)
    VALUES (v_row.id, 'assigned', auth.uid(), jsonb_build_object('moderator_user_id', _moderator_user_id, 'customer_id', _customer_id));
    RETURN jsonb_build_object('inbox_id', v_row.id, 'order_id', NULL);
  END IF;

  -- كل البنود لازم تكون مربوطة.
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_row.items) LOOP
    SELECT * INTO v_map FROM public.woo_product_map m
     WHERE m.woo_product_id = (v_line->>'woo_product_id')::bigint
       AND m.woo_variation_id IN (coalesce(nullif(v_line->>'woo_variation_id','')::bigint, 0), 0)
     ORDER BY m.woo_variation_id DESC LIMIT 1;
    IF NOT FOUND THEN
      v_unmapped := v_unmapped || jsonb_build_array(v_line->>'name');
    END IF;
  END LOOP;
  IF jsonb_array_length(v_unmapped) > 0 THEN
    RAISE EXCEPTION 'WEB_UNMAPPED_ITEMS: %', v_unmapped::text;
  END IF;
  IF jsonb_array_length(v_row.items) = 0 THEN RAISE EXCEPTION 'WEB_NO_ITEMS'; END IF;

  -- العميل: بدون دمج تلقائي.
  IF _customer_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = _customer_id) THEN RAISE EXCEPTION 'WEB_CUSTOMER_NOT_FOUND'; END IF;
    v_customer := _customer_id;
  ELSE
    IF v_row.possible_duplicate AND NOT _create_new_customer THEN RAISE EXCEPTION 'WEB_CUSTOMER_CHOICE_REQUIRED'; END IF;
    IF v_row.phone_norm IS NULL THEN RAISE EXCEPTION 'WEB_PHONE_REQUIRED'; END IF;
    INSERT INTO public.customers (name, phone, phone2, email, address, city, governorate, source)
    VALUES (coalesce(nullif(btrim(v_row.customer_name), ''), 'عميل الموقع'), v_row.phone_norm,
            nullif(public.normalize_phone_eg(v_row.phone2_raw), ''), v_row.email, v_row.address,
            v_row.city, v_row.governorate, 'ويب سايت')
    RETURNING id INTO v_customer;
  END IF;

  v_order_no := public.generate_order_number();
  v_notes := concat_ws(E'\n',
    'طلب من الموقع رقم ' || v_row.woo_order_id,
    CASE WHEN v_row.payment_method_title IS NOT NULL THEN 'طريقة الدفع على الموقع: ' || v_row.payment_method_title END,
    CASE WHEN coalesce(v_row.shipping_total, 0) <> 0 THEN 'شحن الموقع: ' || v_row.shipping_total END,
    CASE WHEN v_row.order_total IS NOT NULL THEN 'إجمالي الموقع: ' || v_row.order_total END,
    CASE WHEN nullif(btrim(v_row.customer_note), '') IS NOT NULL THEN 'ملاحظة العميل: ' || v_row.customer_note END);

  -- منفذ التنفيذ فارغ (قرار 3). الإنشاء بـ created_by = NULL مثل أي طلب لم يُسجَّل من شاشة الطلب،
  -- ثم نقل الملكية للمودريتور. trigger enforce_order_fulfillment_source يبقى كما هو ويُطبَّق
  -- عندما تحفظ المودريتور طريقة التنفيذ/المخزن/شركة الشحن.
  INSERT INTO public.orders (
    order_number, customer_id, status, payment_method, discount, delivery_fee, notes,
    delivery_address, created_by, moderator, source, fulfillment_type, source_warehouse_id,
    shipping_company, woo_order_id, web_attribution
  ) VALUES (
    v_order_no, v_customer, 'pending', 'cash', 0, 0, v_notes,
    v_row.address, NULL, v_mod_name, 'ويب سايت', NULL, NULL, NULL,
    v_row.woo_order_id, v_row.attribution
  ) RETURNING id INTO v_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_row.items) LOOP
    SELECT * INTO v_map FROM public.woo_product_map m
     WHERE m.woo_product_id = (v_line->>'woo_product_id')::bigint
       AND m.woo_variation_id IN (coalesce(nullif(v_line->>'woo_variation_id','')::bigint, 0), 0)
     ORDER BY m.woo_variation_id DESC LIMIT 1;
    v_qty := greatest(coalesce((v_line->>'quantity')::numeric, 1), 0);
    IF v_qty = 0 THEN CONTINUE; END IF;

    IF v_map.kind = 'product' THEN
      -- وزن عبوة الموقع بوحدة COCEG: الكمية = عدد العبوات × الوزن، والسعر لوحدة COCEG = سعر العبوة ÷ الوزن.
      v_pack := coalesce(nullif(v_map.site_pack_qty, 0), 1);
      v_cqty := round(v_qty * v_pack, 2);
      v_unit := coalesce(round(nullif(v_line->>'unit_price','')::numeric / v_pack, 2),
                         (SELECT price FROM public.products WHERE id = v_map.product_id), 0);
      INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, is_half_kg, is_gift)
      SELECT v_order_id, p.id, p.name, v_cqty, v_unit, round(v_unit * v_cqty, 2),
             (v_pack = 0.5 AND coalesce(p.unit, 'كجم') = 'كجم'), false
      FROM public.products p WHERE p.id = v_map.product_id;
      IF v_pack <> 1 THEN
        v_packs := v_packs || jsonb_build_array(jsonb_build_object(
          'woo_product_id', v_map.woo_product_id, 'site_qty', v_qty, 'site_pack_qty', v_pack, 'coc_qty', v_cqty));
      END IF;
    ELSE
      -- بوكس: مكونات الكتالوج بأسعارها (custom_price) × عدد البوكسات. سعر البوكس وشحنه من coceg.
      SELECT * INTO v_box FROM public.offer_boxes WHERE id = v_map.offer_box_id;
      INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, is_half_kg, is_gift, offer_name)
      SELECT v_order_id, i.product_id, p.name, i.quantity * v_qty,
             CASE WHEN coalesce(i.is_gift, false) THEN 0 ELSE coalesce(i.custom_price, p.price, 0) END,
             round(CASE WHEN coalesce(i.is_gift, false) THEN 0 ELSE coalesce(i.custom_price, p.price, 0) END * i.quantity * v_qty, 2),
             false, coalesce(i.is_gift, false), v_box.name
      FROM public.offer_box_items i JOIN public.products p ON p.id = i.product_id
      WHERE i.offer_box_id = v_box.id AND coalesce(i.quantity, 0) > 0;
      v_boxes := v_boxes || jsonb_build_array(jsonb_build_object('offer_box_id', v_box.id, 'offer_name', v_box.name, 'quantity', v_qty));
      v_fee := v_fee + coalesce(v_box.shipping_cost, 0) * v_qty;
      v_has_box := true;
    END IF;
  END LOOP;

  IF v_has_box THEN
    -- نفس مسار شاشة الطلب الجديد: عدد البوكسات + تجميد شحن كل بوكس من الكتالوج.
    PERFORM public.set_order_offer_instances(v_order_id, v_boxes);
    -- الشحن جوه سعر البوكس: delivery_fee = شحن البوكس × عدد النسخ (زي NewOrder).
    UPDATE public.orders SET delivery_fee = v_fee WHERE id = v_order_id;
  END IF;

  -- إعادة حساب الإجمالي بعد delivery_fee (trigger البنود يحسب عند الإدراج فقط).
  UPDATE public.orders o SET
    subtotal = s.sub,
    total = s.sub - coalesce(o.discount, 0) + coalesce(o.extra_charge, 0) + coalesce(o.delivery_fee, 0)
  FROM (SELECT coalesce(sum(total_price), 0) AS sub FROM public.order_items WHERE order_id = v_order_id) s
  WHERE o.id = v_order_id
  RETURNING o.total INTO v_total;

  -- ملكية الطلب للمودريتور (تقدر تعدّله من /orders حسب RLS created_by).
  UPDATE public.orders SET created_by = _moderator_user_id WHERE id = v_order_id;

  UPDATE public.customers SET total_orders = coalesce(total_orders, 0) + 1,
                              total_spent = coalesce(total_spent, 0) + coalesce(v_total, 0)
  WHERE id = v_customer;

  UPDATE public.website_inbox SET status = 'assigned', assigned_moderator_user_id = _moderator_user_id,
    assigned_customer_id = v_customer, created_order_id = v_order_id, assigned_by = auth.uid(),
    assigned_at = now(), updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.notifications (title, description, type, order_id, target_user_id)
  VALUES ('🌐 طلب جديد من الموقع',
          'تم إسناد الطلب ' || v_order_no || ' (موقع رقم ' || v_row.woo_order_id || ') إليكِ. اتصلي بالعميل وحدّدي طريقة التنفيذ.',
          'website_order_assigned', v_order_id, _moderator_user_id);

  INSERT INTO public.website_inbox_audit (inbox_id, action, actor, details)
  VALUES (v_row.id, 'assigned', auth.uid(), jsonb_build_object(
    'moderator_user_id', _moderator_user_id, 'customer_id', v_customer,
    'new_customer', _customer_id IS NULL, 'order_id', v_order_id, 'order_number', v_order_no,
    'delivery_fee', v_fee, 'total', v_total, 'site_packs', v_packs));

  RETURN jsonb_build_object('inbox_id', v_row.id, 'order_id', v_order_id, 'order_number', v_order_no, 'total', v_total);
END $$;

REVOKE ALL ON FUNCTION public.website_inbox_assign(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_inbox_assign(uuid, uuid, uuid, boolean) TO authenticated;
