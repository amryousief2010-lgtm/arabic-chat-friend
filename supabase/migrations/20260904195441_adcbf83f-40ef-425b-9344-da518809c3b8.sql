CREATE OR REPLACE FUNCTION public.set_order_source_warehouse()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.source_warehouse_id IS NULL THEN
    NEW.source_warehouse_id := public.resolve_order_source_warehouse(NEW.shipping_company);
  END IF;
  RETURN NEW;
END
$function$;