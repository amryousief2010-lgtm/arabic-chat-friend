DROP FUNCTION IF EXISTS public.pc_list_eligible_orders();

CREATE OR REPLACE FUNCTION public.pc_list_eligible_orders()
RETURNS TABLE(id uuid, order_number text, status text, total numeric, payment_method text, payment_status text, created_at timestamp with time zone, delivery_address text, notes text, customer_id uuid, customer_name text, customer_phone text, customer_governorate text, assigned_route_id uuid, tracking_status pc_courier_status, tracking_courier_id uuid, planning_region text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
         ro.route_id, t.courier_status, t.courier_id,
         ro.planning_region
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