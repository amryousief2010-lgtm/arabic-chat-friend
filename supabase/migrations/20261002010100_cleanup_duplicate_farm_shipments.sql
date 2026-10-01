-- P0 Issue 1: backup + cancel clear duplicate farm_to_hatchery_shipments;
-- block receive on old inbox for cancelled / duplicate / orphan (no farm_transfer_id) rows.

-- 1) Full backup (idempotent-ish: drop if re-run same day after failed apply)
DROP TABLE IF EXISTS public._migration_backup_farm_to_hatchery_shipments_20261002;
CREATE TABLE public._migration_backup_farm_to_hatchery_shipments_20261002 AS
SELECT * FROM public.farm_to_hatchery_shipments;

COMMENT ON TABLE public._migration_backup_farm_to_hatchery_shipments_20261002 IS
  'P0 2026-10-02 backup before cancelling clear duplicate pending farm shipments';

-- 2) Cancel clear duplicates: pending rows that already have a received/partial twin
--    on same production_id + production_date + egg_count.
UPDATE public.farm_to_hatchery_shipments p
SET
  status = 'rejected',
  rejection_reason = COALESCE(p.rejection_reason, '') ||
    CASE WHEN COALESCE(p.rejection_reason, '') = '' THEN '' ELSE ' | ' END ||
    'مرفوضة تلقائياً — نسخة مكررة من شحنة مستلمة مسبقاً (P0 cleanup 2026-10-02 / superseded)',
  updated_at = now()
WHERE p.status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM public.farm_to_hatchery_shipments r
    WHERE r.status IN ('received', 'partial')
      AND r.production_id IS NOT DISTINCT FROM p.production_id
      AND r.production_date = p.production_date
      AND r.egg_count = p.egg_count
      AND r.id <> p.id
  );

-- 3) Guard: block receiving via direct UPDATE when unsafe
CREATE OR REPLACE FUNCTION public.trg_guard_farm_shipment_receive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only care when moving into a received-like status
  IF TG_OP = 'UPDATE'
     AND LOWER(COALESCE(NEW.status, '')) IN ('received', 'partial')
     AND LOWER(COALESCE(OLD.status, '')) IS DISTINCT FROM LOWER(COALESCE(NEW.status, ''))
  THEN
    IF LOWER(COALESCE(OLD.status, '')) IN ('cancelled', 'rejected') THEN
      RAISE EXCEPTION 'لا يمكن استلام شحنة مرفوضة/ملغاة. استخدم «تحميل وارد المزرعة» من شاشة المعمل.';
    END IF;

    -- Official path requires farm_transfer_id (HatcheryLab «تحميل وارد المزرعة»)
    IF NEW.farm_transfer_id IS NULL THEN
      RAISE EXCEPTION 'استلام الشحنات اليتيمة/القديمة من صندوق الوارد معطّل. المسار الصحيح: «تحميل وارد المزرعة» فقط.';
    END IF;

    -- Twin already received
    IF EXISTS (
      SELECT 1 FROM public.farm_to_hatchery_shipments r
      WHERE r.id <> NEW.id
        AND r.status IN ('received', 'partial')
        AND r.production_id IS NOT DISTINCT FROM NEW.production_id
        AND r.production_date = NEW.production_date
        AND r.egg_count = NEW.egg_count
    ) THEN
      RAISE EXCEPTION 'هذه الشحنة مكررة لشحنة مستلمة مسبقاً — تم حظر الاستلام لمنع دفعات تفريخ وهمية.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_farm_shipment_receive ON public.farm_to_hatchery_shipments;
CREATE TRIGGER trg_guard_farm_shipment_receive
  BEFORE UPDATE ON public.farm_to_hatchery_shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_guard_farm_shipment_receive();

COMMENT ON FUNCTION public.trg_guard_farm_shipment_receive() IS
  'P0 2026-10-02: block old-inbox receive for cancelled/duplicate/orphan shipments; official path is HatcheryLab farm intake.';
