-- P0 — Server-side bulk delivery cap.
-- One statement may move at most 20 orders into status delivered.
-- A single-order update is one row and is never rejected.
--
-- Exempt (cannot be forged through the Data API):
--   current_user postgres, service_role, supabase_admin.
--   That covers SQL run as the database owner, SECURITY DEFINER functions
--   owned by postgres, and edge functions that use the service-role key.
--   Those edge functions also update one order per statement:
--     supabase/functions/sync-zodex-deliveries
--     supabase/functions/sync-zodex-shipments (cancels; does not bulk-deliver)
--     supabase/functions/import-sales (inserts one delivered order at a time)
--     supabase/functions/process-bostta-delivery
--   The sheet button ZodexSheetUpdateButton updates one order per request.
--   No gap-fill script in the repo bulk-updates order status; any such script
--   running as postgres or service_role is covered by the role exemption.
--
-- Safe human bypass: general_manager and executive_manager, via has_role(auth.uid()).
-- The historical app role admin was renamed to general_manager and is not a
-- separate enum value, so it is not checked on its own. The bypass is not a
-- column the client can set on the order.

CREATE OR REPLACE FUNCTION public.bulk_delivery_cap_role_bypass()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (
       public.has_role(auth.uid(), 'general_manager'::public.app_role)
       OR public.has_role(auth.uid(), 'executive_manager'::public.app_role)
     );
$$;

REVOKE ALL ON FUNCTION public.bulk_delivery_cap_role_bypass() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_delivery_cap_role_bypass() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_bulk_delivery_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- Invoker role, not a JWT claim the session can overwrite.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NULL;
  END IF;

  IF public.bulk_delivery_cap_role_bypass() THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT count(*)::integer INTO v_count
      FROM new_orders
     WHERE status = 'delivered';
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT count(*)::integer INTO v_count
      FROM new_orders n
      JOIN old_orders o ON o.id = n.id
     WHERE n.status = 'delivered'
       AND o.status IS DISTINCT FROM 'delivered';
  END IF;

  IF v_count > 20 THEN
    RAISE EXCEPTION
      'الحد الأقصى لتسليم دفعة واحدة هو 20 طلباً. هذه العملية تحوّل % طلباً إلى تم التسليم.',
      v_count;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_bulk_delivery_cap_insert ON public.orders;
CREATE TRIGGER trg_bulk_delivery_cap_insert
AFTER INSERT ON public.orders
REFERENCING NEW TABLE AS new_orders
FOR EACH STATEMENT
EXECUTE FUNCTION public.enforce_bulk_delivery_cap();

DROP TRIGGER IF EXISTS trg_bulk_delivery_cap_update ON public.orders;
CREATE TRIGGER trg_bulk_delivery_cap_update
AFTER UPDATE ON public.orders
REFERENCING OLD TABLE AS old_orders NEW TABLE AS new_orders
FOR EACH STATEMENT
EXECUTE FUNCTION public.enforce_bulk_delivery_cap();
