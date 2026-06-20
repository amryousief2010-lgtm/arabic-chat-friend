
CREATE OR REPLACE FUNCTION public.lab_treasury_check_expense_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_manager boolean;
  opening_total numeric := 0;
  movements_total numeric := 0;
  current_total numeric := 0;
BEGIN
  IF NEW.movement_type <> 'expense' THEN
    RETURN NEW;
  END IF;

  is_manager := has_role(auth.uid(), 'general_manager'::app_role)
             OR has_role(auth.uid(), 'executive_manager'::app_role);

  IF is_manager THEN RETURN NEW; END IF;

  -- Total approved opening balance across ALL payment methods (matches dashboard)
  SELECT COALESCE(SUM(
    COALESCE(cash_amount,0)
    + COALESCE(vodafone_cash_amount,0)
    + COALESCE(instapay_amount,0)
    + COALESCE(bank_transfer_amount,0)
  ), 0)
  INTO opening_total
  FROM public.lab_treasury_opening_balances
  WHERE status = 'approved';

  -- Net of approved movements across ALL payment methods
  SELECT COALESCE(SUM(
    CASE WHEN movement_type = 'income'  AND status = 'approved' THEN amount
         WHEN movement_type = 'expense' AND status = 'approved' THEN -amount
         ELSE 0 END
  ), 0) INTO movements_total
  FROM public.lab_treasury_movements;

  current_total := opening_total + movements_total;

  IF NEW.amount > current_total THEN
    RAISE EXCEPTION 'الرصيد الإجمالي المعتمد لخزنة المعمل غير كافٍ. الرصيد الإجمالي المتاح: % ج (افتتاحي: % + صافي الحركات المعتمدة: %)، المبلغ المطلوب: % ج. راجع المبلغ المُدخل أو اطلب اعتماد المدير.',
      current_total, opening_total, movements_total, NEW.amount
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;
