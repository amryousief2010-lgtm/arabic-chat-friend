
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS collection_method TEXT,
  ADD COLUMN IF NOT EXISTS courier_cash_due NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collection_note TEXT,
  ADD COLUMN IF NOT EXISTS collection_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS collection_updated_by UUID;

-- Validate allowed values via trigger (avoids CHECK on mutable data & keeps legacy rows OK)
CREATE OR REPLACE FUNCTION public.validate_order_collection_method()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.collection_method IS NOT NULL AND NEW.collection_method NOT IN (
    'cash_courier','vodafone_cash','instapay','prepaid','none'
  ) THEN
    RAISE EXCEPTION 'invalid collection_method: %', NEW.collection_method;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_order_collection_method ON public.orders;
CREATE TRIGGER trg_validate_order_collection_method
BEFORE INSERT OR UPDATE OF collection_method ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.validate_order_collection_method();
