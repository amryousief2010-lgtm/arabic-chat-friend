ALTER TABLE public.slaughter_custody_expenses
  ALTER COLUMN category TYPE text USING category::text;