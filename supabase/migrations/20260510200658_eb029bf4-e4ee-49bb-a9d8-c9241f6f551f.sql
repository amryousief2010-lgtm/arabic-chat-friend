-- =====================================================
-- 1. إضافة أدوار جديدة لكل وحدة
-- =====================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'farm_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hatchery_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'brooding_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'slaughterhouse_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'meat_factory_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'feed_factory_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr_manager';