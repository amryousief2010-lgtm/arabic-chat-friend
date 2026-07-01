ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS update_status_marker TEXT,
  ADD COLUMN IF NOT EXISTS update_status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS update_status_updated_by UUID;