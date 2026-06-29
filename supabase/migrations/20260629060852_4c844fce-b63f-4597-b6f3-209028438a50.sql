ALTER TABLE public.agouza_reservation_audit_log
ADD COLUMN IF NOT EXISTS success boolean NOT NULL DEFAULT true;