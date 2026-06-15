CREATE OR REPLACE FUNCTION public.lab_treasury_from_chick_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_batch text;
  v_ref text;
  v_desc text;
  v_id uuid;
  v_pm text;
BEGIN
  -- Do not create treasury movement for prior balance settlements
  v_pm := lower(coalesce(NEW.payment_method::text, ''));
  IF v_pm IN ('credit_prior_balance','opening_credit','prior_balance')
     OR v_pm LIKE '%prior_balance%'
     OR v_pm LIKE '%رصيد%' THEN
    RETURN NEW;
  END IF;

  BEGIN
    EXECUTE 'SELECT batch_number FROM public.brooding_batches WHERE id = $1'
      INTO v_batch USING NEW.batch_id;
  EXCEPTION WHEN OTHERS THEN v_batch := NULL;
  END;
  v_ref := 'بيع كتاكيت - دفعة ' || COALESCE(v_batch, substr(NEW.batch_id::text,1,8));
  v_desc := v_ref
    || ' - عدد: ' || NEW.count::text
    || ' × ' || NEW.unit_price::text;

  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, income_category,
    customer_name, units_count, unit_price, amount, payment_method,
    description, notes, status, created_by,
    source_table, source_id, source_ref
  ) VALUES (
    'income', NEW.sale_date, 'chick_sales',
    NEW.customer_name, NEW.count, NEW.unit_price, NEW.total_amount,
    lab_treasury_map_payment(NEW.payment_method),
    v_desc, NEW.notes, 'pending', COALESCE(NEW.created_by, auth.uid()),
    'brooding_chick_sales', NEW.id, v_ref
  )
  ON CONFLICT (source_table, source_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.lab_treasury_audit_log (action, movement_id, actor_id, actor_name, reason, metadata)
    VALUES ('insert_income', v_id, COALESCE(NEW.created_by, auth.uid()), 'system:trigger',
      'تم إنشاء حركة إيراد تلقائيًا من بيع كتاكيت',
      jsonb_build_object('source_table','brooding_chick_sales','source_id',NEW.id,'batch',v_batch));
  END IF;
  RETURN NEW;
END;
$function$;

-- Also apply the same rule to hatch_customer_payments trigger (settlements from prior balance shouldn't enter treasury)
CREATE OR REPLACE FUNCTION public.lab_treasury_from_hatch_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cust text;
  v_ref text;
  v_id uuid;
  v_pm text;
BEGIN
  v_pm := lower(coalesce(NEW.payment_method::text, ''));
  -- Do not create treasury movement for prior balance settlements
  IF v_pm IN ('credit_prior_balance','opening_credit','prior_balance')
     OR v_pm LIKE '%prior_balance%'
     OR v_pm LIKE '%رصيد%' THEN
    RETURN NEW;
  END IF;

  BEGIN
    EXECUTE 'SELECT name FROM public.hatch_customers WHERE id = $1'
      INTO v_cust USING NEW.customer_id;
  EXCEPTION WHEN OTHERS THEN v_cust := NULL;
  END;
  v_ref := 'تحصيل تفريخ - ' || COALESCE(v_cust, substr(NEW.customer_id::text,1,8));

  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, income_category,
    customer_name, amount, payment_method,
    description, notes, status, created_by,
    source_table, source_id, source_ref
  ) VALUES (
    'income', NEW.payment_date, 'hatching',
    v_cust, NEW.amount,
    lab_treasury_map_payment(NEW.payment_method),
    v_ref, NEW.notes, 'pending', COALESCE(NEW.created_by, auth.uid()),
    'hatch_customer_payments', NEW.id, v_ref
  )
  ON CONFLICT (source_table, source_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN NEW;
END;
$function$;