ALTER TABLE public.feed_sales ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE public.feed_sales DROP CONSTRAINT IF EXISTS feed_sales_payment_method_check;
ALTER TABLE public.feed_sales ADD CONSTRAINT feed_sales_payment_method_check CHECK (payment_method IS NULL OR payment_method IN ('cash','vodafone_cash_ahmed_elgamal','vodafone_cash_mohamed_shaala','bank_transfer','deferred'));