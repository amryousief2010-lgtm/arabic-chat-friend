ALTER TABLE public.payroll_bonus_overrides ADD COLUMN IF NOT EXISTS deduction numeric;
ALTER TABLE public.payroll_month_snapshots ADD COLUMN IF NOT EXISTS deductions numeric NOT NULL DEFAULT 0;