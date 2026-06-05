
CREATE OR REPLACE FUNCTION public.lab_external_after_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ext RECORD;
  v_total_deposited numeric;
  v_movement_id uuid;
BEGIN
  SELECT * INTO v_ext FROM public.lab_treasury_external_collections WHERE id = NEW.external_collection_id FOR UPDATE;

  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, income_category, amount, payment_method,
    description, customer_name, notes, status, created_by,
    source_table, source_id, source_ref
  ) VALUES (
    'income', NEW.deposit_date,
    CASE v_ext.source WHEN 'hatching' THEN 'hatching'::lab_treasury_income_category
                      WHEN 'chick_sales' THEN 'chick_sales'::lab_treasury_income_category
                      ELSE 'other'::lab_treasury_income_category END,
    NEW.amount, NEW.payment_method,
    'توريد تحصيل خارجي من: ' || v_ext.holder_name,
    v_ext.holder_name, NEW.notes, 'pending', NEW.created_by,
    'lab_treasury_external_deposits', NEW.id,
    'External deposit from ' || v_ext.holder_name
  ) RETURNING id INTO v_movement_id;

  UPDATE public.lab_treasury_external_deposits SET movement_id = v_movement_id WHERE id = NEW.id;

  SELECT COALESCE(SUM(amount),0) INTO v_total_deposited
  FROM public.lab_treasury_external_deposits WHERE external_collection_id = NEW.external_collection_id;

  UPDATE public.lab_treasury_external_collections
  SET deposited_amount = v_total_deposited,
      status = CASE
        WHEN v_total_deposited >= amount THEN 'fully_deposited'::lab_external_status
        WHEN v_total_deposited > 0 THEN 'partially_deposited'::lab_external_status
        ELSE 'not_deposited'::lab_external_status END,
      updated_at = now()
  WHERE id = NEW.external_collection_id;

  BEGIN
    INSERT INTO public.lab_treasury_audit_log (action, movement_id, actor_id, actor_name, after_data, reason)
    VALUES ('external_deposit', v_movement_id, NEW.created_by, 'system', to_jsonb(NEW), 'External deposit created');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN NEW;
END $$;
