CREATE OR REPLACE FUNCTION public.guard_main_warehouse_treasury_nonneg()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  cur_balance numeric;
  new_out numeric := 0;
BEGIN
  IF NEW.status = 'posted' AND NEW.direction = 'out' THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' AND OLD.direction = 'out' THEN
      new_out := NEW.amount - OLD.amount;
    ELSE
      new_out := NEW.amount;
    END IF;

    IF new_out > 0 THEN
      SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END), 0)
        INTO cur_balance
        FROM public.main_warehouse_treasury_txns
       WHERE status = 'posted'
         AND id <> NEW.id;

      IF cur_balance - NEW.amount < 0 THEN
        RAISE EXCEPTION 'رصيد خزينة المخزن الرئيسي غير كافٍ: الرصيد الحالي %، المطلوب صرف %', cur_balance, NEW.amount
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_mwt_nonneg ON public.main_warehouse_treasury_txns;
CREATE TRIGGER trg_guard_mwt_nonneg
BEFORE INSERT OR UPDATE ON public.main_warehouse_treasury_txns
FOR EACH ROW EXECUTE FUNCTION public.guard_main_warehouse_treasury_nonneg();