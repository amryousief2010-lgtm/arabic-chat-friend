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