CREATE OR REPLACE FUNCTION public.lab_treasury_guard_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_manager boolean;
  day_closed boolean;
  check_date date;
BEGIN
  is_manager := has_role(auth.uid(), 'general_manager'::app_role)
             OR has_role(auth.uid(), 'executive_manager'::app_role);

  IF TG_OP = 'DELETE' THEN
    check_date := OLD.movement_date;
  ELSE
    check_date := COALESCE(NEW.movement_date, OLD.movement_date);
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.lab_treasury_day_closures
    WHERE closure_date = check_date AND reopened_at IS NULL
  ) INTO day_closed;

  IF day_closed AND NOT is_manager THEN
    RAISE EXCEPTION 'هذا اليوم مُقفل ولا يمكن تعديل أو حذف حركاته إلا بصلاحية المدير العام أو التنفيذي';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'approved'
       AND NOT is_manager
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.movement_type IS NOT DISTINCT FROM OLD.movement_type
       AND NEW.movement_date IS NOT DISTINCT FROM OLD.movement_date
       AND NEW.income_category IS NOT DISTINCT FROM OLD.income_category
       AND NEW.expense_category IS NOT DISTINCT FROM OLD.expense_category
       AND NEW.customer_name IS NOT DISTINCT FROM OLD.customer_name
       AND NEW.units_count IS NOT DISTINCT FROM OLD.units_count
       AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
       AND NEW.amount IS NOT DISTINCT FROM OLD.amount
       AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.beneficiary IS NOT DISTINCT FROM OLD.beneficiary
       AND NEW.notes IS NOT DISTINCT FROM OLD.notes
       AND NEW.receipt_url IS NOT DISTINCT FROM OLD.receipt_url
       AND NEW.rejection_reason IS NOT DISTINCT FROM OLD.rejection_reason
       AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
       AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
       AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
       AND NEW.rejected_by IS NOT DISTINCT FROM OLD.rejected_by
       AND NEW.rejected_at IS NOT DISTINCT FROM OLD.rejected_at
       AND NEW.deletion_reason IS NOT DISTINCT FROM OLD.deletion_reason
       AND NEW.edit_reason IS NOT DISTINCT FROM OLD.edit_reason
       AND NEW.source_table IS NOT DISTINCT FROM OLD.source_table
       AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
       AND NEW.source_ref IS NOT DISTINCT FROM OLD.source_ref
    THEN
      RETURN NEW;
    END IF;

    IF OLD.status = 'approved' AND NOT is_manager THEN
      RAISE EXCEPTION 'لا يمكن تعديل حركة معتمدة إلا بصلاحية المدير العام أو التنفيذي';
    END IF;

    IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected'::lab_treasury_status THEN
      IF NEW.rejection_reason IS NULL OR length(trim(NEW.rejection_reason)) < 3 THEN
        RAISE EXCEPTION 'سبب الرفض إلزامي (3 أحرف على الأقل)';
      END IF;
      NEW.rejected_by := auth.uid();
      NEW.rejected_at := now();
    END IF;

    IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'::lab_treasury_status THEN
      NEW.approved_by := auth.uid();
      NEW.approved_at := now();
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;