ALTER TABLE public.hr_deductions
  ADD COLUMN IF NOT EXISTS days_count numeric,
  ADD COLUMN IF NOT EXISTS daily_value numeric,
  ADD COLUMN IF NOT EXISTS days_per_month smallint,
  ADD COLUMN IF NOT EXISTS monthly_salary_snapshot numeric;