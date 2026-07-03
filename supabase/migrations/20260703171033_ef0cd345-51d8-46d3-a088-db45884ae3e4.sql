
-- Fix mutable search_path on 3 functions
CREATE OR REPLACE FUNCTION public.compute_courier_line_reference_value()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_price numeric;
BEGIN
  IF NEW.line_type IN ('bonus', 'return') THEN
    IF COALESCE(NEW.total_value, 0) = 0 THEN
      v_price := COALESCE(NEW.unit_price, NEW.original_price, 0);
      NEW.total_value := COALESCE(NEW.quantity, 0) * v_price;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.next_chick_trading_settlement_no(_date date)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE _n int;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(settlement_no,'^CTS-\d{8}-','','g'))::int),0)+1
    INTO _n
  FROM public.chick_trading_debt_settlements
  WHERE settlement_no LIKE 'CTS-' || to_char(_date,'YYYYMMDD') || '-%';
  RETURN 'CTS-' || to_char(_date,'YYYYMMDD') || '-' || lpad(_n::text,3,'0');
END $function$;

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

-- Remove overly permissive USING(true)/WITH CHECK(true) policy on courier_daily_cash_deposit_lines.
-- The service_role bypasses RLS by default, so this policy is redundant and unsafe if the role is ever widened.
DROP POLICY IF EXISTS "Service role manages deposit lines" ON public.courier_daily_cash_deposit_lines;
