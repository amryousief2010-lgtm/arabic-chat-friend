
UPDATE public.hatchery_pricing_settings
   SET daily_brooding_price = 10, updated_at = now()
 WHERE daily_brooding_price <> 10;

DO $$
DECLARE
  r RECORD;
  v_debit_le17 NUMERIC;
  v_credits    NUMERIC;
  v_remaining  NUMERIC;
  v_already    BOOLEAN;
  v_customers_settled INT := 0;
  v_total_settled NUMERIC := 0;
  v_actor uuid := auth.uid();
  v_anchor_batch_id uuid;
  v_desc text := 'تسوية تاريخية للدفعات 1 إلى 17';
  v_notes text := 'إغلاق تاريخي للدفعات من 1 إلى 17 بناءً على اعتماد الإدارة — تعتبر خرجت وتم تحصيلها بالكامل';
BEGIN
  SELECT id INTO v_anchor_batch_id
    FROM public.hatch_batches
   WHERE operational_batch_no BETWEEN 1 AND 17
   ORDER BY operational_batch_no DESC, receive_date DESC
   LIMIT 1;

  FOR r IN
    SELECT DISTINCT customer_id
      FROM public.lab_customer_ledger
     WHERE entry_type = 'batch_charge'
       AND operational_batch_no BETWEEN 1 AND 17
       AND customer_id IS NOT NULL
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.lab_customer_ledger
       WHERE customer_id = r.customer_id
         AND entry_type = 'historical_closeout'
         AND description = v_desc
    ) INTO v_already;
    IF v_already THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(debit),0) INTO v_debit_le17
      FROM public.lab_customer_ledger
     WHERE customer_id = r.customer_id
       AND entry_type = 'batch_charge'
       AND operational_batch_no BETWEEN 1 AND 17;

    SELECT COALESCE(SUM(credit),0) INTO v_credits
      FROM public.lab_customer_ledger
     WHERE customer_id = r.customer_id
       AND entry_type IN ('collection','historical_closeout','discount','adjustment','internal_settlement');

    v_remaining := v_debit_le17 - v_credits;

    IF v_remaining > 0 THEN
      INSERT INTO public.lab_customer_ledger(
        customer_id, entry_date, entry_type, source_type, source_id,
        credit, payment_method, description, notes
      ) VALUES (
        r.customer_id, CURRENT_DATE,
        'historical_closeout','historical_closeout', gen_random_uuid(),
        v_remaining, 'historical_settlement',
        v_desc, v_notes
      );
      v_customers_settled := v_customers_settled + 1;
      v_total_settled := v_total_settled + v_remaining;
    END IF;
  END LOOP;

  DECLARE r2 RECORD;
  BEGIN
    FOR r2 IN SELECT DISTINCT customer_id FROM public.lab_customer_ledger WHERE customer_id IS NOT NULL LOOP
      PERFORM public.lab_ledger_recompute_balance(r2.customer_id);
    END LOOP;
  END;

  IF v_anchor_batch_id IS NOT NULL THEN
    INSERT INTO public.hatch_batch_edit_audit(
      batch_id, batch_number, operational_batch_no, customer_id, customer_name,
      actor_id, actor_name, changes, reason
    ) VALUES (
      v_anchor_batch_id, 'BATCHES_1_TO_17', '1-17', NULL, NULL,
      v_actor, 'system:historical_closeout',
      jsonb_build_object(
        'action','historical_closeout',
        'range','1..17',
        'customers_settled_this_run', v_customers_settled,
        'total_settled_this_run_egp', v_total_settled,
        'treasury_impact','NONE — ledger-only credit, payment_method=historical_settlement',
        'executed_at', now()
      ),
      v_notes
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.lab_treasury_from_invoice_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer text;
  v_invoice  text;
  v_batch    text;
  v_eggs     integer;
  v_ref      text;
  v_desc     text;
  v_id       uuid;
BEGIN
  SELECT i.client_name_snapshot, i.invoice_no, i.eggs_in, hb.batch_number
    INTO v_customer, v_invoice, v_eggs, v_batch
    FROM public.hatchery_client_invoices i
    LEFT JOIN public.hatchery_batches hb ON hb.id = i.batch_id
   WHERE i.id = NEW.invoice_id;

  v_ref  := 'توريد تفريخ - فاتورة ' || COALESCE(v_invoice,'-')
            || ' - دفعة ' || COALESCE(v_batch,'-')
            || ' - العميل ' || COALESCE(v_customer,'-');
  v_desc := v_ref || COALESCE(' - عدد البيض: ' || v_eggs::text, '');

  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, income_category,
    customer_name, units_count, amount, payment_method,
    description, notes, status, created_by,
    source_table, source_id, source_ref
  ) VALUES (
    'income', COALESCE(NEW.paid_at::date, CURRENT_DATE), 'hatching',
    v_customer, v_eggs, NEW.amount, lab_treasury_map_payment(NEW.method),
    v_desc, NEW.notes, 'pending', COALESCE(NEW.received_by, auth.uid()),
    'hatchery_invoice_payments', NEW.id, v_ref
  )
  ON CONFLICT (source_table, source_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.lab_treasury_audit_log (action, movement_id, actor_id, actor_name, reason, metadata)
    VALUES ('insert_income', v_id, COALESCE(NEW.received_by, auth.uid()), 'system:trigger',
      'توريد تفريخ — حركة إيراد تلقائية من تحصيل فاتورة',
      jsonb_build_object('source_table','hatchery_invoice_payments','source_id',NEW.id,'invoice',v_invoice,'batch',v_batch));
  END IF;
  RETURN NEW;
END;
$function$;
