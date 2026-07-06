
-- 1) New role enum values
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'marketing_sales_viewer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'lab_treasury_viewer';
