
-- 1) Remove existing (incorrect) historical_closeout entries
DELETE FROM public.lab_customer_ledger
WHERE entry_type = 'historical_closeout'
  AND source_type = 'historical_closeout';

-- 2) For each customer, settle only debits for batches <= 15,
--    netted against already-recorded real collections (FIFO assumption).
DO $$
DECLARE
  r RECORD;
  v_debit_le15 NUMERIC;
  v_credits NUMERIC;
  v_closeout NUMERIC;
BEGIN
  FOR r IN SELECT DISTINCT customer_id FROM public.lab_customer_ledger
           WHERE entry_type='batch_charge' AND operational_batch_no <= 15
  LOOP
    SELECT COALESCE(SUM(debit),0) INTO v_debit_le15
      FROM public.lab_customer_ledger
      WHERE customer_id=r.customer_id
        AND entry_type='batch_charge'
        AND operational_batch_no <= 15;

    SELECT COALESCE(SUM(credit),0) INTO v_credits
      FROM public.lab_customer_ledger
      WHERE customer_id=r.customer_id
        AND entry_type='collection';

    v_closeout := v_debit_le15 - v_credits;
    IF v_closeout > 0 THEN
      INSERT INTO public.lab_customer_ledger(
        customer_id, entry_date, entry_type, source_type, source_id,
        credit, payment_method, description, notes
      ) VALUES (
        r.customer_id, CURRENT_DATE,
        'historical_closeout','historical_closeout', gen_random_uuid(),
        v_closeout, 'historical_settlement',
        'تسوية تاريخية للدفعات حتى رقم 15',
        'تسوية مستحقات الدفعات حتى الدفعة 15 فقط — الدفعات بعدها تبقى مستحقة حتى السداد الفعلي'
      );
    END IF;
  END LOOP;
END $$;

-- 3) Recompute balances
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT customer_id FROM public.lab_customer_ledger LOOP
    PERFORM public.lab_ledger_recompute_balance(r.customer_id);
  END LOOP;
END $$;
