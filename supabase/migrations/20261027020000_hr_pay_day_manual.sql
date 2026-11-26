-- يوم صرف يدوي: يعدّله المدير العام/المدير التنفيذي فقط، ولا تلغيه القاعدة الآلية لاحقًا.
ALTER TABLE public.hr_employees ADD COLUMN IF NOT EXISTS pay_day_manual boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.hr_employees_set_pay_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.pay_day IS DISTINCT FROM OLD.pay_day OR NEW.pay_day_manual IS DISTINCT FROM OLD.pay_day_manual)
     AND auth.uid() IS NOT NULL
     AND NOT (public.has_role(auth.uid(), 'general_manager'::app_role)
              OR public.has_role(auth.uid(), 'executive_manager'::app_role)) THEN
    RAISE EXCEPTION 'تعديل يوم الصرف للمدير العام والمدير التنفيذي فقط';
  END IF;

  IF NEW.pay_day_manual THEN
    IF NEW.pay_day NOT IN (1, 5, 15) THEN
      RAISE EXCEPTION 'يوم الصرف يجب أن يكون 1 أو 5 أو 15';
    END IF;
    RETURN NEW; -- القيمة اليدوية تبقى
  END IF;

  NEW.pay_day := public.hr_compute_pay_day(NEW.full_name, NEW.current_location_id, NEW.department);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_hr_employees_pay_day ON public.hr_employees;
CREATE TRIGGER trg_hr_employees_pay_day
  BEFORE INSERT OR UPDATE OF full_name, current_location_id, department, pay_day, pay_day_manual
  ON public.hr_employees FOR EACH ROW EXECUTE FUNCTION public.hr_employees_set_pay_day();
