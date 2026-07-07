CREATE OR REPLACE FUNCTION public.validate_mixed_payment_breakdown()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s numeric(14,2);
  t numeric(14,2);
BEGIN
  IF NEW.collection_method = 'mixed_payment' THEN
    s := COALESCE(NEW.courier_cash_due, 0)
       + COALESCE(NEW.vodafone_cash_amount, 0)
       + COALESCE(NEW.instapay_amount, 0)
       + COALESCE(NEW.bank_transfer_amount, 0)
       + COALESCE(NEW.other_amount, 0)
       + COALESCE(NEW.free_amount, 0)
       + COALESCE(NEW.deposit_amount, 0);
    t := COALESCE(NEW.total, 0);
    IF abs(s - t) > 0.01 THEN
      RAISE EXCEPTION 'مجموع مبالغ التحصيل (%.2f) لا يساوي قيمة الأوردر (%.2f)', s, t;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_mixed_payment_breakdown ON public.orders;
CREATE TRIGGER trg_validate_mixed_payment_breakdown
BEFORE INSERT OR UPDATE OF collection_method, courier_cash_due, vodafone_cash_amount, instapay_amount, bank_transfer_amount, other_amount, free_amount, deposit_amount, total
ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.validate_mixed_payment_breakdown();