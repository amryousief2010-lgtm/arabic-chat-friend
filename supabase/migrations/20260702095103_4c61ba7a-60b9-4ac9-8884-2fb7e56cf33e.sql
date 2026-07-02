CREATE OR REPLACE FUNCTION public.validate_order_collection_method()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.collection_method IS NOT NULL AND NEW.collection_method NOT IN (
    'cash_courier','vodafone_cash','instapay','prepaid','none','mixed_payment','bank_transfer','other'
  ) THEN
    RAISE EXCEPTION 'invalid collection_method: %', NEW.collection_method;
  END IF;
  RETURN NEW;
END;
$$;