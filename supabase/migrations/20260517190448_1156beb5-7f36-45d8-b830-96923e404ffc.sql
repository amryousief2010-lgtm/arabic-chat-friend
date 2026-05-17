
CREATE OR REPLACE FUNCTION public.validate_and_audit_slaughter_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Validate receipt_date present and not in future
  IF NEW.receipt_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: تاريخ التوريد مطلوب';
  END IF;
  IF NEW.receipt_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'INVALID_DATE: لا يمكن استخدام تاريخ في المستقبل';
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.receipt_date, DATE '1900-01-01') <> COALESCE(NEW.receipt_date, DATE '1900-01-01') THEN
    -- Only specific roles may modify the date
    IF NOT public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::app_role,
      'executive_manager'::app_role,
      'slaughterhouse_manager'::app_role
    ]) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك بتعديل تاريخ التوريد';
    END IF;

    INSERT INTO public.slaughter_audit_log
      (action, target_type, target_id, performed_by, old_value, new_value, notes)
    VALUES
      ('receipt_date_change', 'receipt', NEW.id, auth.uid(),
       jsonb_build_object('receipt_date', OLD.receipt_date),
       jsonb_build_object('receipt_date', NEW.receipt_date),
       format('تعديل تاريخ التوريد للاستلام %s من %s إلى %s',
              NEW.receipt_number, OLD.receipt_date, NEW.receipt_date));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_and_audit_slaughter_receipt ON public.slaughter_live_receipts;
CREATE TRIGGER trg_validate_and_audit_slaughter_receipt
BEFORE INSERT OR UPDATE ON public.slaughter_live_receipts
FOR EACH ROW
EXECUTE FUNCTION public.validate_and_audit_slaughter_receipt();
