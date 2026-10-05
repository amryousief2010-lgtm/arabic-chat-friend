-- New orders write order_offer_instances from the client after the items.
-- The insert policy requires instance.created_by = auth.uid() and
-- orders.created_by = auth.uid(). sales_moderator is not in the manager
-- bypass, and rows in this project have created_by null, so the insert
-- fails after the order and items are already saved. The employee sees
-- «حدث خطأ أثناء إنشاء الطلب» and no instance row is stored.
--
-- sync_order_offer_instances only inserts a missing name at quantity 1 and
-- does not raise an existing count. This function replaces the order's
-- instance rows with the quantities the employee actually chose. Role
-- checks match sync. RLS policies are unchanged. Historical orders are
-- not updated here.

CREATE OR REPLACE FUNCTION public.set_order_offer_instances(
  p_order_id uuid,
  p_instances jsonb
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

  IF p_instances IS NULL OR jsonb_typeof(p_instances) <> 'array' THEN
    RAISE EXCEPTION 'بيانات البوكسات غير صالحة';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_instances) AS x(item)
    WHERE NULLIF(btrim(COALESCE(x.item->>'offer_name', '')), '') IS NULL
       OR COALESCE(NULLIF(x.item->>'quantity', '')::numeric, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'كمية البوكس يجب أن تكون أكبر من صفر';
  END IF;

  DELETE FROM public.order_offer_instances
  WHERE order_id = p_order_id;

  INSERT INTO public.order_offer_instances (
    order_id, offer_box_id, offer_name, quantity, created_by
  )
  SELECT
    p_order_id,
    (
      SELECT NULLIF(x.item->>'offer_box_id', '')::uuid
      FROM jsonb_array_elements(p_instances) AS x(item)
      WHERE btrim(x.item->>'offer_name') = names.offer_name
        AND NULLIF(x.item->>'offer_box_id', '') IS NOT NULL
      LIMIT 1
    ),
    names.offer_name,
    names.quantity::integer,
    auth.uid()
  FROM (
    SELECT
      btrim(g.item->>'offer_name') AS offer_name,
      SUM((g.item->>'quantity')::numeric) AS quantity
    FROM jsonb_array_elements(p_instances) AS g(item)
    GROUP BY btrim(g.item->>'offer_name')
  ) AS names;
END;
$$;

REVOKE ALL ON FUNCTION public.set_order_offer_instances(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_order_offer_instances(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_order_offer_instances(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_offer_instances(uuid, jsonb) TO service_role;
