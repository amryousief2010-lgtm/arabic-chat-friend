
-- 1) Add new enum values
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'lab_external_collector';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'lab_treasury_approver';
