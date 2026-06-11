
-- 1) Add vehicle fields to custody expenses
ALTER TABLE public.slaughter_custody_expenses
  ADD COLUMN IF NOT EXISTS vehicle_plate text,
  ADD COLUMN IF NOT EXISTS vehicle_label text;

CREATE INDEX IF NOT EXISTS idx_custody_exp_vehicle
  ON public.slaughter_custody_expenses (vehicle_plate, category, expense_date)
  WHERE vehicle_plate IS NOT NULL;

-- 2) Dedup table for monthly vehicle expense threshold alerts
CREATE TABLE IF NOT EXISTS public.vehicle_expense_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_plate text NOT NULL,
  expense_category text NOT NULL,
  month text NOT NULL, -- 'YYYY-MM'
  alert_type text NOT NULL DEFAULT 'monthly_vehicle_expense_threshold',
  threshold_amount numeric(14,2) NOT NULL DEFAULT 8000,
  total_amount numeric(14,2) NOT NULL,
  triggering_expense_id uuid REFERENCES public.slaughter_custody_expenses(id) ON DELETE SET NULL,
  triggering_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_plate, expense_category, month, alert_type)
);

GRANT SELECT ON public.vehicle_expense_alerts TO authenticated;
GRANT ALL ON public.vehicle_expense_alerts TO service_role;

ALTER TABLE public.vehicle_expense_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Custody managers and accountants can view vehicle alerts"
ON public.vehicle_expense_alerts FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'financial_manager'::app_role,
    'accountant'::app_role,
    'main_treasury_accountant'::app_role,
    'slaughterhouse_manager'::app_role,
    'slaughterhouse_custody_keeper'::app_role
  ])
);

-- 3) Trigger function: when monthly vehicle+category total crosses 8000, notify accountant(s) once
CREATE OR REPLACE FUNCTION public.fn_notify_vehicle_expense_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month text;
  v_total numeric;
  v_threshold numeric := 8000;
  v_existing uuid;
  v_user uuid;
  v_plate_label text;
  v_msg text;
  v_title text;
BEGIN
  IF NEW.vehicle_plate IS NULL OR length(trim(NEW.vehicle_plate)) = 0 THEN
    RETURN NEW;
  END IF;
  -- only count expenses that are pending or approved (exclude rejected)
  IF NEW.status = 'rejected' THEN
    RETURN NEW;
  END IF;

  v_month := to_char(NEW.expense_date, 'YYYY-MM');

  SELECT COALESCE(SUM(amount), 0)
    INTO v_total
  FROM public.slaughter_custody_expenses
  WHERE vehicle_plate = NEW.vehicle_plate
    AND category = NEW.category
    AND to_char(expense_date, 'YYYY-MM') = v_month
    AND status <> 'rejected';

  IF v_total <= v_threshold THEN
    RETURN NEW;
  END IF;

  -- check dedup
  SELECT id INTO v_existing
  FROM public.vehicle_expense_alerts
  WHERE vehicle_plate = NEW.vehicle_plate
    AND expense_category = NEW.category
    AND month = v_month
    AND alert_type = 'monthly_vehicle_expense_threshold';

  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.vehicle_expense_alerts (
    vehicle_plate, expense_category, month, threshold_amount, total_amount,
    triggering_expense_id, triggering_user_id
  ) VALUES (
    NEW.vehicle_plate, NEW.category, v_month, v_threshold, v_total,
    NEW.id, NEW.created_by
  )
  ON CONFLICT (vehicle_plate, expense_category, month, alert_type) DO NOTHING;

  v_plate_label := NEW.vehicle_plate;
  IF NEW.vehicle_label IS NOT NULL AND length(trim(NEW.vehicle_label)) > 0 THEN
    v_plate_label := NEW.vehicle_plate || ' — ' || NEW.vehicle_label;
  END IF;

  v_title := 'تنبيه مصروفات مركبة';
  v_msg := 'العربية ' || v_plate_label || ' صرفت ' || NEW.category
        || ' بإجمالي ' || to_char(v_total, 'FM999,999,990.00')
        || ' جنيه خلال شهر ' || v_month
        || '، وهذا يتجاوز الحد المسموح ' || to_char(v_threshold, 'FM999,999,990')
        || ' جنيه. برجاء المراجعة.';

  -- Notify accountants and senior managers
  FOR v_user IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role IN (
      'main_treasury_accountant'::app_role,
      'accountant'::app_role,
      'financial_manager'::app_role,
      'general_manager'::app_role,
      'executive_manager'::app_role
    )
  LOOP
    INSERT INTO public.notifications (title, description, type, target_user_id)
    VALUES (v_title, v_msg, 'vehicle_expense_alert', v_user);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_vehicle_expense_threshold
  ON public.slaughter_custody_expenses;
CREATE TRIGGER trg_notify_vehicle_expense_threshold
  AFTER INSERT OR UPDATE OF amount, vehicle_plate, category, expense_date, status
  ON public.slaughter_custody_expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_vehicle_expense_threshold();
