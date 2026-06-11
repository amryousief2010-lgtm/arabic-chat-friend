
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
  -- Read invoice + batch number from the NEW hatchery_batches table
  SELECT i.client_name_snapshot,
         i.invoice_no,
         i.eggs_in,
         hb.batch_number
    INTO v_customer, v_invoice, v_eggs, v_batch
    FROM public.hatchery_client_invoices i
    LEFT JOIN public.hatchery_batches hb ON hb.id = i.batch_id
   WHERE i.id = NEW.invoice_id;

  v_ref  := 'تحصيل فاتورة ' || COALESCE(v_invoice,'')
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
      'تم إنشاء حركة إيراد تلقائيًا من تحصيل فاتورة تفريخ',
      jsonb_build_object(
        'source_table','hatchery_invoice_payments',
        'source_id', NEW.id,
        'invoice', v_invoice,
        'batch', v_batch
      ));
  END IF;
  RETURN NEW;
END;
$function$;
