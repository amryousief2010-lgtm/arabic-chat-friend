
-- 1) Set security_invoker on the remaining view so it enforces caller's RLS
ALTER VIEW public.v_treasury_inter_balances SET (security_invoker = on);

-- 2) Pin search_path on pc_set_updated_at trigger function
CREATE OR REPLACE FUNCTION public.pc_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END
$function$;

-- 3) Replace permissive INSERT policy on treasury_transfer_audit_log
DROP POLICY IF EXISTS ttal_insert ON public.treasury_transfer_audit_log;
CREATE POLICY ttal_insert_authorized
  ON public.treasury_transfer_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid() AND can_view_treasury_transfer(auth.uid()));
