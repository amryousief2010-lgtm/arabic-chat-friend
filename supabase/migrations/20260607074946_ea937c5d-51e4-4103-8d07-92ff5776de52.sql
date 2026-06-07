
-- 1) Add 'archived' to route status enum
DO $$ BEGIN
  ALTER TYPE public.pc_route_status ADD VALUE IF NOT EXISTS 'archived';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
