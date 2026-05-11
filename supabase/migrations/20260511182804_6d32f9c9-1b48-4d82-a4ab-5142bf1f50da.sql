CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_number TEXT;
  attempts INT := 0;
BEGIN
  IF NOT has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'sales_manager'::app_role,
    'sales_moderator'::app_role
  ]) THEN
    RAISE EXCEPTION 'Not authorized to generate order numbers';
  END IF;

  LOOP
    new_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                  LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE order_number = new_number) THEN
      RETURN new_number;
    END IF;

    attempts := attempts + 1;
    IF attempts > 10 THEN
      RAISE EXCEPTION 'Could not generate unique order number';
    END IF;
  END LOOP;
END;
$function$;