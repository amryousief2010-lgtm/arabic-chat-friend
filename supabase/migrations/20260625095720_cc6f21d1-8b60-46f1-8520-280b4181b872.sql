
-- Notification trigger for high-balance threshold on main warehouse treasury
CREATE OR REPLACE FUNCTION public.notify_main_warehouse_high_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold numeric := 20000;
  v_balance_after numeric;
  v_balance_before numeric;
  v_uid uuid;
BEGIN
  IF COALESCE(NEW.status,'posted') <> 'posted' THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0)
    INTO v_balance_after
  FROM public.main_warehouse_treasury_txns
  WHERE status='posted';

  v_balance_before := v_balance_after - CASE WHEN NEW.direction='in' THEN NEW.amount ELSE -NEW.amount END;

  -- Fire only on crossing the threshold upward
  IF v_balance_after > v_threshold AND v_balance_before <= v_threshold THEN
    FOR v_uid IN
      SELECT DISTINCT user_id FROM public.user_roles
      WHERE role IN ('general_manager','financial_manager','main_treasury_accountant')
    LOOP
      INSERT INTO public.notifications(user_id, type, title, message, read)
      VALUES (
        v_uid,
        'main_warehouse_balance_high',
        'رصيد خزينة المخزن الرئيسي تجاوز الحد',
        'الرصيد الحالي ' || to_char(v_balance_after,'FM999,999,990.00') || ' ج.م تجاوز ' || to_char(v_threshold,'FM999,999,990') || ' ج.م. يفضّل التحويل للخزينة الرئيسية.',
        false
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_main_warehouse_high_balance ON public.main_warehouse_treasury_txns;
CREATE TRIGGER trg_notify_main_warehouse_high_balance
AFTER INSERT ON public.main_warehouse_treasury_txns
FOR EACH ROW EXECUTE FUNCTION public.notify_main_warehouse_high_balance();
