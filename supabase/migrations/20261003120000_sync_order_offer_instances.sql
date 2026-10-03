-- The orders card and search read order_offer_instances. Item save used to
-- rewrite order_items only, then the client tried to delete/insert instance
-- rows and ignored failures. sales_moderator cannot delete those rows (policy
-- is general_manager, executive_manager, sales_manager only), and an insert
-- without created_by fails the insert check. The old box link stayed, so the
-- card kept the old name or showed both names.
--
-- Reconcile the links in the same transaction as save_order_items_edit.
-- Swap and add call the same function after their item writes. Names that
-- still have a real product line keep their row, including quantity. A
-- legacy «تكلفة الشحن» line is not a box. Role policies are unchanged.

CREATE OR REPLACE FUNCTION public.sync_order_offer_instances(
  p_order_id uuid,
  p_box_id uuid DEFAULT NULL,
  p_box_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::public.app_role,
    'executive_manager'::public.app_role,
    'sales_manager'::public.app_role,
    'shipping_company'::public.app_role,
    'sales_moderator'::public.app_role
  ]) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تعديل الطلب';
  END IF;

  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود';
  END IF;

  DELETE FROM public.order_offer_instances oi
  WHERE oi.order_id = p_order_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.order_items i
      WHERE i.order_id = oi.order_id
        AND i.offer_name IS NOT NULL
        AND btrim(i.offer_name) <> ''
        AND btrim(i.offer_name) = btrim(oi.offer_name)
        AND NOT (
          i.product_id IS NULL
          AND btrim(COALESCE(i.product_name, '')) = 'تكلفة الشحن'
        )
    );

  INSERT INTO public.order_offer_instances (
    order_id, offer_box_id, offer_name, quantity, created_by
  )
  SELECT
    p_order_id,
    CASE
      WHEN p_box_id IS NOT NULL
        AND p_box_name IS NOT NULL
        AND btrim(p_box_name) = btrim(names.offer_name)
      THEN p_box_id
      ELSE (
        SELECT b.id
        FROM public.offer_boxes b
        WHERE b.name = names.offer_name
        ORDER BY b.is_active DESC, b.created_at DESC
        LIMIT 1
      )
    END,
    names.offer_name,
    1,
    auth.uid()
  FROM (
    SELECT DISTINCT ON (btrim(i.offer_name)) i.offer_name
    FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND i.offer_name IS NOT NULL
      AND btrim(i.offer_name) <> ''
      AND NOT (
        i.product_id IS NULL
        AND btrim(COALESCE(i.product_name, '')) = 'تكلفة الشحن'
      )
    ORDER BY btrim(i.offer_name), i.offer_name
  ) AS names(offer_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.order_offer_instances oi
    WHERE oi.order_id = p_order_id
      AND btrim(oi.offer_name) = btrim(names.offer_name)
  )
  ON CONFLICT (order_id, offer_name) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_order_offer_instances(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_order_offer_instances(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_order_offer_instances(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_order_offer_instances(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.save_order_items_edit(
  p_order_id uuid,
  p_items jsonb,
  p_subtotal numeric,
  p_discount numeric,
  p_total numeric,
  p_delivery_fee numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_id uuid;
  v_product_id uuid;
  v_qty numeric;
  v_unit numeric;
  v_product_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::public.app_role,
    'executive_manager'::public.app_role,
    'sales_manager'::public.app_role,
    'shipping_company'::public.app_role,
    'sales_moderator'::public.app_role
  ]) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تعديل الطلب';
  END IF;

  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'بيانات المنتجات غير صالحة';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS x(item)
    WHERE (x.item ? 'id')
      AND NULLIF(x.item->>'id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.id = (x.item->>'id')::uuid
          AND oi.order_id = p_order_id
      )
  ) THEN
    RAISE EXCEPTION 'يوجد صنف لا ينتمي لهذا الطلب';
  END IF;

  PERFORM set_config('app.skip_order_recompute', 'on', true);

  DELETE FROM public.order_items oi
  USING jsonb_array_elements(p_items) AS x(item)
  WHERE (x.item->>'_deleted')::boolean IS TRUE
    AND NULLIF(x.item->>'id', '') IS NOT NULL
    AND oi.id = (x.item->>'id')::uuid
    AND oi.order_id = p_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_item->>'_deleted')::boolean, false) THEN
      CONTINUE;
    END IF;

    v_id := NULLIF(v_item->>'id', '')::uuid;
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_unit := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);
    v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), '');

    IF v_product_name = '' THEN
      RAISE EXCEPTION 'اسم المنتج مطلوب';
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر';
    END IF;
    IF v_unit < 0 THEN
      RAISE EXCEPTION 'السعر غير صالح';
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO public.order_items (
        order_id, product_id, product_name, quantity, unit_price, total_price,
        offer_name, is_half_kg, is_gift
      ) VALUES (
        p_order_id,
        v_product_id,
        v_product_name,
        v_qty,
        v_unit,
        v_qty * v_unit,
        NULLIF(v_item->>'offer_name', ''),
        COALESCE((v_item->>'is_half_kg')::boolean, false),
        COALESCE((v_item->>'is_gift')::boolean, false)
      );
    ELSE
      UPDATE public.order_items
      SET product_id = v_product_id,
          product_name = v_product_name,
          quantity = v_qty,
          unit_price = v_unit,
          total_price = v_qty * v_unit,
          offer_name = NULLIF(v_item->>'offer_name', ''),
          is_half_kg = COALESCE((v_item->>'is_half_kg')::boolean, false),
          is_gift = COALESCE((v_item->>'is_gift')::boolean, false)
      WHERE id = v_id
        AND order_id = p_order_id;
    END IF;
  END LOOP;

  UPDATE public.orders
  SET subtotal = COALESCE(p_subtotal, 0),
      discount = COALESCE(p_discount, 0),
      total = COALESCE(p_total, 0),
      delivery_fee = COALESCE(p_delivery_fee, delivery_fee),
      updated_at = now()
  WHERE id = p_order_id;

  PERFORM public.sync_order_offer_instances(p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.save_order_items_edit(uuid, jsonb, numeric, numeric, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_order_items_edit(uuid, jsonb, numeric, numeric, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_order_items_edit(uuid, jsonb, numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_order_items_edit(uuid, jsonb, numeric, numeric, numeric, numeric) TO service_role;
