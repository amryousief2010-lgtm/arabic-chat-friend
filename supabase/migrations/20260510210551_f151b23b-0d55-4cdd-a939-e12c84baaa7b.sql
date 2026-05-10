
CREATE TABLE IF NOT EXISTS public.customer_import_stage (
  name text,
  phone text,
  city text,
  address text,
  total_orders int,
  total_spent numeric,
  notes text
);
ALTER TABLE public.customer_import_stage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON public.customer_import_stage FOR ALL USING (false);
