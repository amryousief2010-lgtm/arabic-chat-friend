
CREATE TABLE public.payroll_bonus_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_name text NOT NULL,
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  year int NOT NULL,
  processed_bonus numeric,
  meat_bonus numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (moderator_name, month, year)
);

ALTER TABLE public.payroll_bonus_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view payroll overrides"
ON public.payroll_bonus_overrides FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Managers can insert payroll overrides"
ON public.payroll_bonus_overrides FOR INSERT
TO authenticated
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE POLICY "Managers can update payroll overrides"
ON public.payroll_bonus_overrides FOR UPDATE
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE POLICY "Managers can delete payroll overrides"
ON public.payroll_bonus_overrides FOR DELETE
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE TRIGGER tg_payroll_bonus_overrides_updated_at
BEFORE UPDATE ON public.payroll_bonus_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
