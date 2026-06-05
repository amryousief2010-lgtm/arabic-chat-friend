
-- Add monthly base salary to butchers
ALTER TABLE public.slaughter_workers ADD COLUMN IF NOT EXISTS monthly_base_salary numeric NOT NULL DEFAULT 0;

-- Set Mahmoud Gamal default = 8000
UPDATE public.slaughter_workers SET monthly_base_salary = 8000 WHERE id = 'c9449aec-a368-434b-94c0-09853662b8b4' AND monthly_base_salary = 0;

-- Payroll settings (single-row config)
CREATE TABLE IF NOT EXISTS public.slaughter_payroll_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bonus_threshold_birds integer NOT NULL DEFAULT 30,
  bonus_per_bird numeric NOT NULL DEFAULT 100,
  lead_share_pct numeric NOT NULL DEFAULT 50,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE ON public.slaughter_payroll_settings TO authenticated;
GRANT ALL ON public.slaughter_payroll_settings TO service_role;

ALTER TABLE public.slaughter_payroll_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payroll settings read" ON public.slaughter_payroll_settings;
CREATE POLICY "payroll settings read" ON public.slaughter_payroll_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "payroll settings manage" ON public.slaughter_payroll_settings;
CREATE POLICY "payroll settings manage" ON public.slaughter_payroll_settings
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'general_manager'::app_role) OR
    has_role(auth.uid(), 'executive_manager'::app_role) OR
    has_role(auth.uid(), 'slaughterhouse_manager'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'general_manager'::app_role) OR
    has_role(auth.uid(), 'executive_manager'::app_role) OR
    has_role(auth.uid(), 'slaughterhouse_manager'::app_role)
  );

-- Seed default settings row if empty
INSERT INTO public.slaughter_payroll_settings (bonus_threshold_birds, bonus_per_bird, lead_share_pct)
SELECT 30, 100, 50
WHERE NOT EXISTS (SELECT 1 FROM public.slaughter_payroll_settings);
