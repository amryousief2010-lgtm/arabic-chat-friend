CREATE OR REPLACE FUNCTION public.lab_treasury_check_expense_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_manager boolean;
  opening_balance numeric := 0;
  movements_balance numeric := 0;
  current_balance numeric := 0;
  method_label text;
BEGIN
  IF NEW.movement_type <> 'expense' THEN
    RETURN NEW;
  END IF;

  is_manager := has_role(auth.uid(), 'general_manager'::app_role)
             OR has_role(auth.uid(), 'executive_manager'::app_role);

  IF is_manager THEN RETURN NEW; END IF;

  -- Approved opening balance for the selected payment method
  SELECT COALESCE(SUM(
    CASE NEW.payment_method::text
      WHEN 'cash' THEN cash_amount
      WHEN 'vodafone_cash' THEN vodafone_cash_amount
      WHEN 'instapay' THEN instapay_amount
      WHEN 'bank_transfer' THEN bank_transfer_amount
      ELSE 0
    END
  ), 0)
  INTO opening_balance
  FROM public.lab_treasury_opening_balances
  WHERE status = 'approved';

  -- Net of approved movements for same payment method
  SELECT COALESCE(SUM(
    CASE WHEN movement_type = 'income'  AND status = 'approved' THEN amount
         WHEN movement_type = 'expense' AND status = 'approved' THEN -amount
         ELSE 0 END
  ), 0) INTO movements_balance
  FROM public.lab_treasury_movements
  WHERE payment_method = NEW.payment_method;

  current_balance := opening_balance + movements_balance;

  IF NEW.amount > current_balance THEN
    method_label := CASE NEW.payment_method::text
      WHEN 'cash' THEN 'النقدية (كاش)'
      WHEN 'vodafone_cash' THEN 'فودافون كاش'
      WHEN 'instapay' THEN 'انستاباي'
      WHEN 'bank_transfer' THEN 'التحويل البنكي'
      ELSE NEW.payment_method::text END;
    RAISE EXCEPTION 'الرصيد المتاح في % غير كافٍ. المتاح: % ج (افتتاحي: % + صافي الحركات: %)، المطلوب: % ج. راجع المبلغ المُدخل أو اطلب اعتماد المدير.',
      method_label, current_balance, opening_balance, movements_balance, NEW.amount
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;