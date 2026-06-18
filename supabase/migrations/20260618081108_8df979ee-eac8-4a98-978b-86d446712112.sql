
-- Tighten warehouse operational-start enforcement to cover all real decrement movement types
CREATE OR REPLACE FUNCTION public.enforce_warehouse_operational_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _start_date DATE;
  _is_decrement boolean;
BEGIN
  _is_decrement := (
    NEW.movement_type IN ('out','transfer','sales_dispatch')
    OR (NEW.movement_type IN ('adjustment','adjust') AND COALESCE(NEW.quantity, 0) < 0)
  );

  IF NOT _is_decrement THEN
    RETURN NEW;
  END IF;

  SELECT operational_start_date INTO _start_date
    FROM public.warehouses
   WHERE id = NEW.warehouse_id;

  IF _start_date IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.performed_at, now())::date < _start_date THEN
    RAISE EXCEPTION USING
      MESSAGE = 'هذا الأوردر/الحركة قبل تاريخ بداية تشغيل المخزن ولا يؤثر على الجرد. (' || _start_date::text || ')',
      ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;
