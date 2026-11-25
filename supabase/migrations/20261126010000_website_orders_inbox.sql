-- =====================================================================
-- طلبات وتسجيلات موقع capitalostrich.com (ووكومرس) → صندوق استقبال في coceg
-- قرار م. عمرو (25/11/2026):
--   1) الطلبات والتسجيلات تنتظر في website_inbox حتى تسندها م. آلاء حامد لمودريتور،
--      وعندها فقط يُنشأ الطلب في orders/order_items باسم المودريتور.
--   2) أي بند غير مربوط في woo_product_map يمنع التحويل حتى يُربط. لا بنود product_id = NULL.
--   3) منفذ التنفيذ (استلام/توصيل، المخزن، شركة الشحن) يبقى فارغاً وتحدده المودريتور بعد
--      مكالمة العميل. trigger enforce_order_fulfillment_source كما هو، ويُطبَّق عند تعديلها.
--   4) الشاشة والدوال لـ sales_manager و general_manager و executive_manager فقط.
-- قواعد ثابتة: لا دمج تلقائي للعملاء (تنبيه تكرار فقط)، لا كتابة في cm_ad_attributions،
-- شحن البوكسات من الكتالوج (shipping_cost) عبر set_order_offer_instances و delivery_fee.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) أعمدة مصدر الطلب على orders نفسها (مش cm_ad_attributions)
-- ---------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS woo_order_id bigint,
  ADD COLUMN IF NOT EXISTS web_attribution jsonb;

COMMENT ON COLUMN public.orders.woo_order_id IS 'رقم طلب ووكومرس على capitalostrich.com (طلب موقع فقط).';
COMMENT ON COLUMN public.orders.web_attribution IS 'مصدر عميل الموقع (UTM / referrer / fbclid / gclid / صفحة الدخول) كما وصل من الموقع.';

CREATE UNIQUE INDEX IF NOT EXISTS orders_woo_order_id_uniq
  ON public.orders (woo_order_id) WHERE woo_order_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 1) الصلاحية
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.website_inbox_can_manage()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(public.has_any_role(
    auth.uid(),
    ARRAY['sales_manager','general_manager','executive_manager']::public.app_role[]
  ), false)
$$;

REVOKE ALL ON FUNCTION public.website_inbox_can_manage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_inbox_can_manage() TO authenticated;

-- ---------------------------------------------------------------------
-- 2) ربط منتجات ووكومرس بمنتجات/بوكسات coceg
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.woo_product_map (
  woo_product_id   bigint  NOT NULL,
  woo_variation_id bigint  NOT NULL DEFAULT 0,
  kind             text    NOT NULL CHECK (kind IN ('product','offer_box')),
  product_id       uuid    REFERENCES public.products(id),
  offer_box_id     uuid    REFERENCES public.offer_boxes(id),
  woo_name         text,
  mapped_by        uuid    REFERENCES auth.users(id),
  mapped_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (woo_product_id, woo_variation_id),
  CONSTRAINT woo_product_map_target_chk CHECK (
    (kind = 'product'   AND product_id IS NOT NULL AND offer_box_id IS NULL) OR
    (kind = 'offer_box' AND offer_box_id IS NOT NULL AND product_id IS NULL)
  )
);

ALTER TABLE public.woo_product_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS woo_product_map_read ON public.woo_product_map;
CREATE POLICY woo_product_map_read ON public.woo_product_map
  FOR SELECT TO authenticated USING ((SELECT public.website_inbox_can_manage()));
-- الكتابة عبر website_inbox_map_product فقط.

-- ---------------------------------------------------------------------
-- 3) صندوق الاستقبال
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.website_inbox (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                     text NOT NULL CHECK (kind IN ('order','registration')),
  woo_order_id             bigint,
  woo_customer_id          bigint,
  woo_status               text,
  status                   text NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new','assigned','dismissed','cancelled_on_site')),
  customer_name            text,
  phone_raw                text,
  phone_norm               text,
  phone2_raw               text,
  email                    text,
  address                  text,
  city                     text,
  governorate              text,
  items                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  shipping_total           numeric(12,2),
  discount_total           numeric(12,2),
  order_total              numeric(12,2),
  payment_method_title     text,
  customer_note            text,
  attribution              jsonb,
  site_created_at          timestamptz,
  possible_duplicate       boolean NOT NULL DEFAULT false,
  duplicate_customer_ids   uuid[] NOT NULL DEFAULT '{}',
  assigned_moderator_user_id uuid REFERENCES auth.users(id),
  assigned_customer_id     uuid REFERENCES public.customers(id),
  created_order_id         uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  assigned_by              uuid REFERENCES auth.users(id),
  assigned_at              timestamptz,
  dismissed_by             uuid REFERENCES auth.users(id),
  dismissed_at             timestamptz,
  dismiss_reason           text,
  last_topic               text,
  last_delivery_id         text,
  event_count              integer NOT NULL DEFAULT 1,
  site_changed_after_assign boolean NOT NULL DEFAULT false,
  first_received_at        timestamptz NOT NULL DEFAULT now(),
  last_event_at            timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_inbox_ref_chk CHECK (
    (kind = 'order' AND woo_order_id IS NOT NULL) OR
    (kind = 'registration' AND woo_customer_id IS NOT NULL)
  )
);

-- منع التكرار (idempotency): طلب ووكومرس واحد = سجل واحد، وعميل ووكومرس واحد = تسجيل واحد.
CREATE UNIQUE INDEX IF NOT EXISTS website_inbox_order_uniq
  ON public.website_inbox (woo_order_id) WHERE kind = 'order';
CREATE UNIQUE INDEX IF NOT EXISTS website_inbox_registration_uniq
  ON public.website_inbox (woo_customer_id) WHERE kind = 'registration';
CREATE INDEX IF NOT EXISTS website_inbox_status_idx
  ON public.website_inbox (status, last_event_at DESC);

ALTER TABLE public.website_inbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS website_inbox_read ON public.website_inbox;
CREATE POLICY website_inbox_read ON public.website_inbox
  FOR SELECT TO authenticated USING ((SELECT public.website_inbox_can_manage()));
-- لا INSERT/UPDATE/DELETE مباشر: الاستقبال بـ service_role عبر website_inbox_upsert،
-- والإسناد/التجاهل عبر الدوال أدناه.

CREATE TABLE IF NOT EXISTS public.website_inbox_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_id   uuid REFERENCES public.website_inbox(id) ON DELETE CASCADE,
  action     text NOT NULL,
  actor      uuid,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS website_inbox_audit_inbox_idx ON public.website_inbox_audit (inbox_id, created_at DESC);

ALTER TABLE public.website_inbox_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS website_inbox_audit_read ON public.website_inbox_audit;
CREATE POLICY website_inbox_audit_read ON public.website_inbox_audit
  FOR SELECT TO authenticated USING ((SELECT public.website_inbox_can_manage()));

-- ---------------------------------------------------------------------
-- 4) الاستقبال من الـ webhook (service_role فقط)
--    _data: حقول مطبَّعة من دالة woo-order-ingest (handler.ts).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.website_inbox_upsert(
  _kind text, _external_id bigint, _data jsonb, _topic text, _delivery_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row   public.website_inbox%ROWTYPE;
  v_norm  text;
  v_norm2 text;
  v_dups  uuid[];
  v_cancel boolean;
  v_created boolean := false;
BEGIN
  IF _kind NOT IN ('order','registration') OR _external_id IS NULL THEN
    RAISE EXCEPTION 'WEB_BAD_INPUT';
  END IF;

  v_norm  := nullif(public.normalize_phone_eg(_data->>'phone'), '');
  v_norm2 := nullif(public.normalize_phone_eg(_data->>'phone2'), '');

  -- تنبيه تكرار فقط (بدون أي دمج): عملاء coceg بنفس الرقم المطبَّع في phone أو phone2.
  SELECT coalesce(array_agg(DISTINCT c.id), '{}') INTO v_dups
  FROM public.customers c
  WHERE (v_norm IS NOT NULL AND (public.normalize_phone_eg(c.phone) = v_norm
           OR (c.phone2 IS NOT NULL AND btrim(c.phone2) <> '' AND public.normalize_phone_eg(c.phone2) = v_norm)))
     OR (v_norm2 IS NOT NULL AND (public.normalize_phone_eg(c.phone) = v_norm2
           OR (c.phone2 IS NOT NULL AND btrim(c.phone2) <> '' AND public.normalize_phone_eg(c.phone2) = v_norm2)));

  v_cancel := lower(coalesce(_data->>'woo_status','')) IN ('cancelled','refunded','failed','trash');

  IF _kind = 'order' THEN
    SELECT * INTO v_row FROM public.website_inbox
     WHERE kind = 'order' AND woo_order_id = _external_id FOR UPDATE;
  ELSE
    SELECT * INTO v_row FROM public.website_inbox
     WHERE kind = 'registration' AND woo_customer_id = _external_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.website_inbox (
      kind, woo_order_id, woo_customer_id, woo_status, status,
      customer_name, phone_raw, phone_norm, phone2_raw, email, address, city, governorate,
      items, shipping_total, discount_total, order_total, payment_method_title, customer_note,
      attribution, site_created_at, possible_duplicate, duplicate_customer_ids,
      last_topic, last_delivery_id
    ) VALUES (
      _kind,
      CASE WHEN _kind = 'order' THEN _external_id END,
      CASE WHEN _kind = 'order' THEN nullif(_data->>'woo_customer_id','')::bigint ELSE _external_id END,
      _data->>'woo_status',
      CASE WHEN v_cancel THEN 'cancelled_on_site' ELSE 'new' END,
      _data->>'customer_name', _data->>'phone', v_norm, _data->>'phone2', _data->>'email',
      _data->>'address', _data->>'city', _data->>'governorate',
      coalesce(_data->'items', '[]'::jsonb),
      nullif(_data->>'shipping_total','')::numeric, nullif(_data->>'discount_total','')::numeric,
      nullif(_data->>'order_total','')::numeric, _data->>'payment_method_title', _data->>'customer_note',
      _data->'attribution', nullif(_data->>'site_created_at','')::timestamptz,
      cardinality(v_dups) > 0, v_dups, _topic, _delivery_id
    ) RETURNING * INTO v_row;
    v_created := true;
    INSERT INTO public.website_inbox_audit (inbox_id, action, details)
    VALUES (v_row.id, 'received', jsonb_build_object('topic', _topic, 'delivery_id', _delivery_id));
  ELSIF v_row.status = 'new' OR v_row.status = 'cancelled_on_site' THEN
    -- لسه ما اتحوّلش: نحدّث البيانات من الموقع.
    UPDATE public.website_inbox SET
      woo_status = coalesce(_data->>'woo_status', woo_status),
      status = CASE WHEN v_cancel THEN 'cancelled_on_site' ELSE 'new' END,
      customer_name = coalesce(_data->>'customer_name', customer_name),
      phone_raw = coalesce(_data->>'phone', phone_raw),
      phone_norm = coalesce(v_norm, phone_norm),
      phone2_raw = coalesce(_data->>'phone2', phone2_raw),
      email = coalesce(_data->>'email', email),
      address = coalesce(_data->>'address', address),
      city = coalesce(_data->>'city', city),
      governorate = coalesce(_data->>'governorate', governorate),
      items = CASE WHEN _kind = 'order' AND jsonb_typeof(_data->'items') = 'array' THEN _data->'items' ELSE items END,
      shipping_total = coalesce(nullif(_data->>'shipping_total','')::numeric, shipping_total),
      discount_total = coalesce(nullif(_data->>'discount_total','')::numeric, discount_total),
      order_total = coalesce(nullif(_data->>'order_total','')::numeric, order_total),
      payment_method_title = coalesce(_data->>'payment_method_title', payment_method_title),
      customer_note = coalesce(_data->>'customer_note', customer_note),
      attribution = coalesce(_data->'attribution', attribution),
      possible_duplicate = cardinality(v_dups) > 0,
      duplicate_customer_ids = v_dups,
      last_topic = _topic, last_delivery_id = _delivery_id,
      event_count = event_count + 1, last_event_at = now(), updated_at = now()
    WHERE id = v_row.id RETURNING * INTO v_row;
    INSERT INTO public.website_inbox_audit (inbox_id, action, details)
    VALUES (v_row.id, 'site_update', jsonb_build_object('topic', _topic, 'delivery_id', _delivery_id, 'woo_status', _data->>'woo_status'));
  ELSE
    -- اتحوّل أو اتجاهل: لا نلمس الطلب المُنشأ. نسجّل الحالة الجديدة وننبّه في الشاشة.
    UPDATE public.website_inbox SET
      woo_status = coalesce(_data->>'woo_status', woo_status),
      site_changed_after_assign = (status = 'assigned'),
      last_topic = _topic, last_delivery_id = _delivery_id,
      event_count = event_count + 1, last_event_at = now(), updated_at = now()
    WHERE id = v_row.id RETURNING * INTO v_row;
    INSERT INTO public.website_inbox_audit (inbox_id, action, details)
    VALUES (v_row.id, 'site_update_after_' || v_row.status, jsonb_build_object('topic', _topic, 'delivery_id', _delivery_id, 'woo_status', _data->>'woo_status'));
  END IF;

  RETURN jsonb_build_object('inbox_id', v_row.id, 'created', v_created, 'status', v_row.status,
                            'possible_duplicate', v_row.possible_duplicate);
END $$;

REVOKE ALL ON FUNCTION public.website_inbox_upsert(text, bigint, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_inbox_upsert(text, bigint, jsonb, text, text) TO service_role;

-- ---------------------------------------------------------------------
-- 5) ربط منتج ووكومرس (م. آلاء / الإدارة)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.website_inbox_map_product(
  _woo_product_id bigint, _woo_variation_id bigint, _product_id uuid, _offer_box_id uuid, _woo_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_kind text;
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WEB_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _woo_product_id IS NULL THEN RAISE EXCEPTION 'WEB_BAD_INPUT'; END IF;
  IF (_product_id IS NULL) = (_offer_box_id IS NULL) THEN RAISE EXCEPTION 'WEB_MAP_ONE_TARGET'; END IF;
  IF _product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products WHERE id = _product_id) THEN
    RAISE EXCEPTION 'WEB_PRODUCT_NOT_FOUND';
  END IF;
  IF _offer_box_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.offer_boxes WHERE id = _offer_box_id) THEN
    RAISE EXCEPTION 'WEB_BOX_NOT_FOUND';
  END IF;
  v_kind := CASE WHEN _product_id IS NOT NULL THEN 'product' ELSE 'offer_box' END;

  INSERT INTO public.woo_product_map (woo_product_id, woo_variation_id, kind, product_id, offer_box_id, woo_name, mapped_by, mapped_at)
  VALUES (_woo_product_id, coalesce(_woo_variation_id, 0), v_kind, _product_id, _offer_box_id, _woo_name, auth.uid(), now())
  ON CONFLICT (woo_product_id, woo_variation_id) DO UPDATE
    SET kind = EXCLUDED.kind, product_id = EXCLUDED.product_id, offer_box_id = EXCLUDED.offer_box_id,
        woo_name = coalesce(EXCLUDED.woo_name, public.woo_product_map.woo_name),
        mapped_by = EXCLUDED.mapped_by, mapped_at = now();

  INSERT INTO public.website_inbox_audit (inbox_id, action, actor, details)
  VALUES (NULL, 'map_product', auth.uid(), jsonb_build_object(
    'woo_product_id', _woo_product_id, 'woo_variation_id', coalesce(_woo_variation_id, 0),
    'product_id', _product_id, 'offer_box_id', _offer_box_id));
END $$;

REVOKE ALL ON FUNCTION public.website_inbox_map_product(bigint, bigint, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_inbox_map_product(bigint, bigint, uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 6) عملاء coceg المحتملين لنفس الرقم (أرقام مقنَّعة) — لاختيار يدوي فقط
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.website_inbox_customer_candidates(_inbox_id uuid)
RETURNS TABLE (customer_id uuid, name text, phone_masked text, total_orders integer, last_order_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WEB_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT c.id, c.name,
         CASE WHEN length(public.normalize_phone_eg(c.phone)) >= 7
              THEN left(public.normalize_phone_eg(c.phone), 3) || '*****' || right(public.normalize_phone_eg(c.phone), 3)
              ELSE '***' END,
         c.total_orders,
         (SELECT max(o.created_at) FROM public.orders o WHERE o.customer_id = c.id)
  FROM public.website_inbox w
  JOIN public.customers c ON c.id = ANY (w.duplicate_customer_ids)
  WHERE w.id = _inbox_id
  ORDER BY c.total_orders DESC NULLS LAST;
END $$;

REVOKE ALL ON FUNCTION public.website_inbox_customer_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_inbox_customer_candidates(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 7) الإسناد لمودريتور (+ إنشاء الطلب لطلبات الموقع)
--    _customer_id: عميل coceg موجود تختاره م. آلاء، أو NULL لإنشاء عميل جديد.
--    لو فيه تنبيه تكرار لازم تختار عميلاً أو تؤكد «عميل جديد» (_create_new_customer = true).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.website_inbox_assign(
  _inbox_id uuid, _moderator_user_id uuid, _customer_id uuid DEFAULT NULL, _create_new_customer boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
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
      v_unit := coalesce(nullif(v_line->>'unit_price','')::numeric,
                         (SELECT price FROM public.products WHERE id = v_map.product_id), 0);
      INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, is_half_kg, is_gift)
      SELECT v_order_id, p.id, p.name, v_qty, v_unit, round(v_unit * v_qty, 2), false, false
      FROM public.products p WHERE p.id = v_map.product_id;
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
    'delivery_fee', v_fee, 'total', v_total));

  RETURN jsonb_build_object('inbox_id', v_row.id, 'order_id', v_order_id, 'order_number', v_order_no, 'total', v_total);
END $$;

REVOKE ALL ON FUNCTION public.website_inbox_assign(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_inbox_assign(uuid, uuid, uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------
-- 8) التجاهل / الأرشفة
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.website_inbox_dismiss(_inbox_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_status text;
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WEB_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN RAISE EXCEPTION 'WEB_REASON_REQUIRED'; END IF;
  SELECT status INTO v_status FROM public.website_inbox WHERE id = _inbox_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_NOT_FOUND'; END IF;
  IF v_status NOT IN ('new','cancelled_on_site') THEN RAISE EXCEPTION 'WEB_NOT_NEW'; END IF;
  UPDATE public.website_inbox SET status = 'dismissed', dismissed_by = auth.uid(), dismissed_at = now(),
    dismiss_reason = btrim(_reason), updated_at = now()
  WHERE id = _inbox_id;
  INSERT INTO public.website_inbox_audit (inbox_id, action, actor, details)
  VALUES (_inbox_id, 'dismissed', auth.uid(), jsonb_build_object('reason', btrim(_reason)));
END $$;

REVOKE ALL ON FUNCTION public.website_inbox_dismiss(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_inbox_dismiss(uuid, text) TO authenticated;
