
-- 1) Widen eligibility RPC to include legacy private-courier orders (NULL fulfillment_type)
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
         c.id, c.name, c.phone, c.governorate,
         ro.route_id, t.courier_status, t.courier_id
  FROM public.orders o
  JOIN public.warehouses w ON w.id = o.source_warehouse_id
  LEFT JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.pc_route_orders ro ON ro.order_id = o.id
  LEFT JOIN public.pc_order_tracking t ON t.order_id = o.id
  WHERE o.shipping_company = 'مندوب خاص'
    AND (o.fulfillment_type = 'delivery' OR o.fulfillment_type IS NULL)
    AND (w.name ILIKE '%الرئيسي%' OR w.name ILIKE '%المقر%')
  ORDER BY o.created_at DESC
  LIMIT 2000;
END $function$;

-- 2) Backfill May & June 2026 private-courier orders
DO $$
DECLARE
  v_main uuid := '5ec781b5-685b-4806-b59a-83a79ea5662c';
  rec record;
  v_route_id uuid;
  v_month_label text;
  v_region text;
  v_route_name text;
  v_planned_date date;
  v_color text;
BEGIN
  FOR rec IN
    SELECT o.id AS order_id, o.created_at, COALESCE(c.governorate,'') AS gov,
      CASE WHEN o.created_at >= '2026-04-30 22:00+00' AND o.created_at < '2026-05-31 22:00+00' THEN 'may'
           ELSE 'jun' END AS m
    FROM public.orders o
    JOIN public.warehouses w ON w.id = o.source_warehouse_id
    LEFT JOIN public.customers c ON c.id = o.customer_id
    WHERE o.shipping_company='مندوب خاص'
      AND (o.fulfillment_type='delivery' OR o.fulfillment_type IS NULL)
      AND w.id = v_main
      AND o.created_at >= '2026-04-30 22:00+00'
      AND o.created_at <  '2026-06-30 22:00+00'
  LOOP
    -- Region mapping
    v_region := CASE
      WHEN rec.gov ~ 'إسكندر|اسكندر|الاسكندري|اسكندري' THEN 'الإسكندرية والساحل'
      WHEN rec.gov ~ 'السويس|سماعيل|بورسعيد|سيناء' THEN 'القناة وسيناء'
      WHEN rec.gov ~ 'القاهر|الجيز|الجيزة' THEN 'القاهرة الكبرى'
      WHEN rec.gov ~ 'الغربي|قليوبي|منوفي|دقهلي|شرقي|كفر الشيخ|كفرالشيخ|دمياط|بحير|المنصور' THEN 'الدلتا'
      WHEN rec.gov ~ 'سوهاج|أسيوط|اسيوط|قنا|الأقصر|الاقصر|أسوان|اسوان|المنيا|بني سويف|الفيوم' THEN 'الصعيد'
      ELSE 'خط غير محدد'
    END;

    v_month_label := CASE WHEN rec.m='may' THEN 'مايو 2026' ELSE 'يونيو 2026' END;
    v_planned_date := CASE WHEN rec.m='may' THEN DATE '2026-05-01' ELSE DATE '2026-06-01' END;
    v_route_name := 'خط ' || v_region || ' - ' || v_month_label;
    v_color := CASE v_region
      WHEN 'الإسكندرية والساحل' THEN '#06b6d4'
      WHEN 'القناة وسيناء' THEN '#f59e0b'
      WHEN 'القاهرة الكبرى' THEN '#8b5cf6'
      WHEN 'الدلتا' THEN '#10b981'
      WHEN 'الصعيد' THEN '#ef4444'
      ELSE '#6b7280' END;

    -- Find or create route
    SELECT id INTO v_route_id FROM public.pc_routes WHERE name = v_route_name LIMIT 1;
    IF v_route_id IS NULL THEN
      INSERT INTO public.pc_routes (name, region, planned_date, status, color, notes)
      VALUES (v_route_name, v_region, v_planned_date, 'planned', v_color, 'Backfill تلقائي - ' || v_month_label)
      RETURNING id INTO v_route_id;
    END IF;

    -- Tracking: insert if missing
    INSERT INTO public.pc_order_tracking (order_id, courier_status)
    VALUES (rec.order_id, 'assigned_to_courier')
    ON CONFLICT (order_id) DO NOTHING;

    -- Route assignment: only if order not yet assigned to ANY route
    INSERT INTO public.pc_route_orders (route_id, order_id, sequence)
    VALUES (v_route_id, rec.order_id, 0)
    ON CONFLICT (order_id) DO NOTHING;
  END LOOP;
END $$;
