
-- 2) Planning-only columns on pc_route_orders
ALTER TABLE public.pc_route_orders
  ADD COLUMN IF NOT EXISTS planning_governorate text,
  ADD COLUMN IF NOT EXISTS planning_city text,
  ADD COLUMN IF NOT EXISTS planning_region text,
  ADD COLUMN IF NOT EXISTS planning_confidence text,
  ADD COLUMN IF NOT EXISTS planning_source text,
  ADD COLUMN IF NOT EXISTS planning_notes text;

-- 3) Restrict eligible-orders RPC to >= 2026-05-01 Cairo
CREATE OR REPLACE FUNCTION public.pc_list_eligible_orders()
 RETURNS TABLE(id uuid, order_number text, status text, total numeric, payment_method text, payment_status text, created_at timestamp with time zone, delivery_address text, notes text, customer_id uuid, customer_name text, customer_phone text, customer_governorate text, assigned_route_id uuid, tracking_status pc_courier_status, tracking_courier_id uuid)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role,'warehouse_supervisor'::app_role,'accountant'::app_role]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY
  SELECT o.id, o.order_number, o.status::text, o.total, o.payment_method::text, o.payment_status::text,
         o.created_at, o.delivery_address, o.notes,
         c.id, c.name, c.phone,
         COALESCE(NULLIF(c.governorate,''), ro.planning_governorate) AS customer_governorate,
         ro.route_id, t.courier_status, t.courier_id
  FROM public.orders o
  JOIN public.warehouses w ON w.id = o.source_warehouse_id
  LEFT JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.pc_route_orders ro ON ro.order_id = o.id
  LEFT JOIN public.pc_order_tracking t ON t.order_id = o.id
  WHERE o.shipping_company = 'مندوب خاص'
    AND (o.fulfillment_type = 'delivery' OR o.fulfillment_type IS NULL)
    AND (w.name ILIKE '%الرئيسي%' OR w.name ILIKE '%المقر%')
    AND o.created_at >= '2026-04-30 22:00:00+00'::timestamptz
    AND o.created_at <= now()
  ORDER BY o.created_at DESC
  LIMIT 2000;
END $function$;

-- 4) Restrict my-deliveries RPC to >= 2026-05-01 Cairo
CREATE OR REPLACE FUNCTION public.pc_get_my_assigned_orders()
 RETURNS TABLE(id uuid, order_number text, status text, total numeric, payment_method text, payment_status text, created_at timestamp with time zone, delivery_address text, notes text, customer_name text, customer_phone text, customer_governorate text, route_id uuid, route_name text, tracking_status pc_courier_status, collection_status pc_collection_status, amount_collected numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  RETURN QUERY
  SELECT o.id, o.order_number, o.status::text, o.total, o.payment_method::text, o.payment_status::text,
         o.created_at, o.delivery_address, o.notes,
         c.name, c.phone, COALESCE(NULLIF(c.governorate,''), ro.planning_governorate),
         t.id AS route_id_placeholder, r.name AS route_name,
         t.courier_status, col.status, col.amount_collected
  FROM public.pc_order_tracking t
  JOIN public.orders o ON o.id = t.order_id
  LEFT JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.pc_route_orders ro ON ro.order_id = o.id
  LEFT JOIN public.pc_routes r ON r.id = ro.route_id
  LEFT JOIN public.pc_collections col ON col.order_id = o.id
  WHERE t.courier_id = auth.uid()
    AND o.created_at >= '2026-04-30 22:00:00+00'::timestamptz
  ORDER BY o.created_at DESC
  LIMIT 1000;
END $function$;

-- 5) Archive pre-May-2026 routes
UPDATE public.pc_routes
SET status = 'archived'
WHERE planned_date < DATE '2026-05-01' AND status <> 'archived';

-- 6) Backfill planning_* fields on in-scope route_orders
WITH ctx AS (
  SELECT ro.order_id,
         COALESCE(NULLIF(TRIM(c.governorate),''), '') AS cust_gov,
         COALESCE(o.delivery_address,'') AS addr
  FROM public.pc_route_orders ro
  JOIN public.orders o ON o.id = ro.order_id
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE o.created_at >= '2026-04-30 22:00:00+00'::timestamptz
), inferred AS (
  SELECT order_id,
    CASE
      WHEN cust_gov <> '' THEN cust_gov
      WHEN addr ~ 'إسكندر|اسكندر|الاسكندري' THEN 'الإسكندرية'
      WHEN addr ~ 'القاهر' THEN 'القاهرة'
      WHEN addr ~ 'الجيز' THEN 'الجيزة'
      WHEN addr ~ 'الغربي|طنطا|المحلة' THEN 'الغربية'
      WHEN addr ~ 'قليوبي|بنها|شبرا' THEN 'القليوبية'
      WHEN addr ~ 'منوفي|شبين' THEN 'المنوفية'
      WHEN addr ~ 'دقهلي|المنصور' THEN 'الدقهلية'
      WHEN addr ~ 'شرقي|الزقازيق' THEN 'الشرقية'
      WHEN addr ~ 'كفر الشيخ|كفرالشيخ' THEN 'كفر الشيخ'
      WHEN addr ~ 'البحير|دمنهور' THEN 'البحيرة'
      WHEN addr ~ 'دمياط' THEN 'دمياط'
      WHEN addr ~ 'السويس' THEN 'السويس'
      WHEN addr ~ 'سماعيل' THEN 'الإسماعيلية'
      WHEN addr ~ 'بورسعيد' THEN 'بورسعيد'
      ELSE NULL
    END AS gov,
    cust_gov, addr
  FROM ctx
)
UPDATE public.pc_route_orders ro
SET
  planning_governorate = i.gov,
  planning_region = CASE
    WHEN i.gov IS NULL THEN 'خط غير محدد'
    WHEN i.gov ~ 'إسكندر|اسكندر|الاسكندري' THEN 'الإسكندرية والساحل'
    WHEN i.gov ~ 'السويس|سماعيل|بورسعيد|سيناء' THEN 'القناة وسيناء'
    WHEN i.gov ~ 'القاهر|الجيز' THEN 'القاهرة الكبرى'
    WHEN i.gov ~ 'الغربي|قليوبي|منوفي|دقهلي|شرقي|كفر الشيخ|كفرالشيخ|دمياط|بحير|المنصور' THEN 'الدلتا'
    WHEN i.gov ~ 'سوهاج|أسيوط|اسيوط|قنا|الأقصر|الاقصر|أسوان|اسوان|المنيا|بني سويف|الفيوم' THEN 'الصعيد'
    ELSE 'خط غير محدد'
  END,
  planning_confidence = CASE
    WHEN i.cust_gov <> '' THEN 'high_confidence'
    WHEN i.gov IS NOT NULL THEN 'medium_confidence'
    WHEN i.addr <> '' THEN 'low_confidence'
    ELSE 'needs_review'
  END,
  planning_source = CASE
    WHEN i.cust_gov <> '' THEN 'customer.governorate'
    WHEN i.gov IS NOT NULL THEN 'orders.delivery_address'
    ELSE 'unresolved'
  END
FROM inferred i
WHERE ro.order_id = i.order_id;
