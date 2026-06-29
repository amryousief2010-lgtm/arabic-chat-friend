ALTER TABLE public.agouza_stock_reservations
ADD COLUMN IF NOT EXISTS committed_by uuid REFERENCES auth.users(id);