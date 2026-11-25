-- =====================================================================
-- طلبات الموقع: المحافظة / المدينة / المنطقة / طريقة التسليم قبل «إسناد وإنشاء الطلب»
-- طلب م. عمرو (25/11/2026):
--   * يُحفظ address_1 / address_2 من الموقع منفصلين (بجانب العنوان المجمّع كما هو).
--   * website_inbox_assign_v2: نفس الإسناد الحالي تماماً (website_inbox_assign) ثم:
--       - عميل جديد: تُكتب المحافظة والمدينة والمنطقة والعنوان (الشارع فقط) في حقولها.
--       - عميل موجود: لا يتغير شيء إلا إذا أكدت م. آلاء «تحديث عنوان العميل» (بدون دمج تلقائي).
--       - الطلب: عنوان التوصيل من الحقول، وطريقة التسليم/المنفذ اختيارية (المودريتور تضبطها أو تغيّرها
--         بعد المكالمة كما هو متفق).
--   * كل ذلك يُسجَّل في website_inbox_audit.
-- يعتمد على 20261126010000_website_orders_inbox.sql.
-- =====================================================================

ALTER TABLE public.website_inbox ADD COLUMN IF NOT EXISTS address_1 text;
ALTER TABLE public.website_inbox ADD COLUMN IF NOT EXISTS address_2 text;

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
      customer_name, phone_raw, phone_norm, phone2_raw, email, address, address_1, address_2, city, governorate,
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
      _data->>'address', _data->>'address_1', _data->>'address_2', _data->>'city', _data->>'governorate',
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
      address_1 = coalesce(_data->>'address_1', address_1),
      address_2 = CASE WHEN _data ? 'address_1' THEN _data->>'address_2' ELSE address_2 END,
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

CREATE OR REPLACE FUNCTION public.website_inbox_assign_v2(
  _inbox_id uuid, _moderator_user_id uuid, _customer_id uuid, _create_new_customer boolean,
  _governorate text, _city text, _area text, _street text,
  _fulfillment_key text, _shipping_company text, _update_customer_address boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_res      jsonb;
  v_order    uuid;
  v_customer uuid;
  v_gov      text := nullif(btrim(_governorate), '');
  v_city     text := nullif(btrim(_city), '');
  v_area     text := nullif(btrim(_area), '');
  v_street   text := nullif(btrim(_street), '');
  v_line     text;
  v_wh       uuid;
  v_ft       text;
  v_ship     text;
  v_cust_upd boolean := false;
BEGIN
  IF NOT public.website_inbox_can_manage() THEN RAISE EXCEPTION 'WEB_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _fulfillment_key IS NOT NULL AND _fulfillment_key NOT IN ('pickup_main','delivery_main','pickup_agouza','delivery_agouza','shipping_company') THEN
    RAISE EXCEPTION 'WEB_BAD_FULFILLMENT';
  END IF;
  IF _fulfillment_key = 'shipping_company' AND nullif(btrim(_shipping_company), '') IS NULL THEN
    RAISE EXCEPTION 'WEB_SHIPPING_COMPANY_REQUIRED';
  END IF;

  v_res := public.website_inbox_assign(_inbox_id, _moderator_user_id, _customer_id, _create_new_customer);
  v_order := nullif(v_res->>'order_id', '')::uuid;
  IF v_order IS NULL THEN RETURN v_res; END IF; -- تسجيل عميل بدون طلب

  SELECT assigned_customer_id INTO v_customer FROM public.website_inbox WHERE id = _inbox_id;

  -- العميل: الجديد يأخذ الحقول المقسّمة؛ الموجود فقط بتأكيد صريح.
  IF v_customer IS NOT NULL AND (_customer_id IS NULL OR coalesce(_update_customer_address, false))
     AND (v_gov IS NOT NULL OR v_city IS NOT NULL OR v_area IS NOT NULL OR v_street IS NOT NULL) THEN
    UPDATE public.customers SET
      governorate = coalesce(v_gov, governorate),
      city = coalesce(v_city, city),
      area = coalesce(v_area, area),
      address = coalesce(v_street, address)
    WHERE id = v_customer;
    v_cust_upd := true;
  END IF;

  -- الطلب: عنوان التوصيل + (اختياري) طريقة التسليم والمنفذ بنفس قواعد شاشة الطلبات.
  SELECT string_agg(p, '، ' ORDER BY ord) INTO v_line
  FROM (SELECT DISTINCT ON (p) p, ord FROM unnest(ARRAY[v_street, v_area, v_city, v_gov]) WITH ORDINALITY AS t(p, ord)
        WHERE p IS NOT NULL ORDER BY p, ord) s;
  IF v_line IS NOT NULL THEN
    UPDATE public.orders SET delivery_address = v_line WHERE id = v_order;
  END IF;

  IF _fulfillment_key IS NOT NULL THEN
    IF _fulfillment_key = 'shipping_company' THEN
      v_wh := NULL; v_ft := 'delivery'; v_ship := btrim(_shipping_company);
    ELSE
      SELECT id INTO v_wh FROM public.warehouses
       WHERE is_active AND (CASE WHEN _fulfillment_key LIKE '%_agouza' THEN name LIKE '%العجوزة%'
                                 ELSE (name LIKE '%الرئيسي%' OR name LIKE '%المقر%') END)
       ORDER BY name LIMIT 1;
      IF v_wh IS NULL THEN RAISE EXCEPTION 'WEB_WAREHOUSE_NOT_FOUND'; END IF;
      v_ft := CASE WHEN _fulfillment_key LIKE 'pickup_%' THEN 'pickup' ELSE 'delivery' END;
      v_ship := CASE WHEN _fulfillment_key = 'delivery_main' THEN 'مندوب خاص' END;
    END IF;
    UPDATE public.orders SET fulfillment_type = v_ft, source_warehouse_id = v_wh, shipping_company = v_ship WHERE id = v_order;
  END IF;

  INSERT INTO public.website_inbox_audit (inbox_id, action, actor, details)
  VALUES (_inbox_id, 'address_fulfillment_set', auth.uid(), jsonb_build_object(
    'order_id', v_order, 'customer_id', v_customer, 'customer_updated', v_cust_upd,
    'governorate', v_gov, 'city', v_city, 'area', v_area, 'street', v_street,
    'delivery_address', v_line, 'fulfillment_key', _fulfillment_key, 'warehouse_id', v_wh, 'shipping_company', v_ship));

  RETURN v_res || jsonb_build_object('customer_updated', v_cust_upd, 'fulfillment_key', _fulfillment_key);
END $$;

REVOKE ALL ON FUNCTION public.website_inbox_assign_v2(uuid, uuid, uuid, boolean, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_inbox_assign_v2(uuid, uuid, uuid, boolean, text, text, text, text, text, text, boolean) TO authenticated;
