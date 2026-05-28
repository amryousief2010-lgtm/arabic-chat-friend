CREATE OR REPLACE FUNCTION public.validate_warehouse_transfer_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN (
    'draft','sent','pending_approval','approved','rejected',
    'pending_receipt','partially_received','received',
    'needs_manager_review','cancelled'
  ) THEN
    RAISE EXCEPTION 'invalid_status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;