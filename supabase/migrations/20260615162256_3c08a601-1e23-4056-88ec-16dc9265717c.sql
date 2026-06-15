
-- 1. Column
ALTER TABLE public.hr_employees
  ADD COLUMN IF NOT EXISTS pay_day smallint NOT NULL DEFAULT 1
    CHECK (pay_day IN (1, 5, 15));

-- 2. Rule function
CREATE OR REPLACE FUNCTION public.hr_compute_pay_day(
  p_full_name text,
  p_location_id uuid,
  p_department text
) RETURNS smallint
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  shipping_id        uuid := 'ca127187-a5c8-4b64-a245-bea7e19ccbd6';
  marketing_id       uuid := '9eec8d84-a3e8-4c10-883e-f03614a3a39c';
  sales_marketing_id uuid := '9416cb24-c83b-4700-bc07-e4688cfc7bd8';
  name_n             text := COALESCE(p_full_name, '');
  dept_n             text := COALESCE(p_department, '');
BEGIN
  -- Highest priority: البواب
  IF name_n ILIKE '%البواب%' THEN
    RETURN 1;
  END IF;

  -- Marketing / ألاء حامد
  IF name_n ILIKE '%ألاء%' OR name_n ILIKE '%الاء%'
     OR p_location_id IN (marketing_id, sales_marketing_id)
     OR dept_n ILIKE '%تسويق%' THEN
    RETURN 5;
  END IF;

  -- Shipping company
  IF p_location_id = shipping_id OR dept_n ILIKE '%شحن%' THEN
    RETURN 15;
  END IF;

  RETURN 1;
END;
$$;

-- 3. Trigger to keep pay_day in sync
CREATE OR REPLACE FUNCTION public.hr_employees_set_pay_day()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.pay_day := public.hr_compute_pay_day(
    NEW.full_name, NEW.current_location_id, NEW.department
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hr_employees_pay_day ON public.hr_employees;
CREATE TRIGGER trg_hr_employees_pay_day
BEFORE INSERT OR UPDATE OF full_name, current_location_id, department
ON public.hr_employees
FOR EACH ROW EXECUTE FUNCTION public.hr_employees_set_pay_day();

-- 4. Enable realtime on hr_deductions (so UI updates immediately)
ALTER TABLE public.hr_deductions REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='hr_deductions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.hr_deductions';
  END IF;
END $$;
