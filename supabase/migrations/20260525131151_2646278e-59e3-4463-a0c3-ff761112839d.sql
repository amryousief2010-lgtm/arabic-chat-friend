ALTER TABLE public.meat_factory_batches ADD COLUMN IF NOT EXISTS planned_total_cost numeric;
ALTER TABLE public.feed_production_batches ADD COLUMN IF NOT EXISTS planned_total_cost numeric;

COMMENT ON COLUMN public.meat_factory_batches.planned_total_cost IS
  'Frozen planned cost snapshot = SUM(planned_qty * unit_cost). NULL = snapshot not available.';
COMMENT ON COLUMN public.feed_production_batches.planned_total_cost IS
  'Frozen planned cost snapshot = SUM(planned_qty * unit_cost). NULL = snapshot not available.';

CREATE OR REPLACE FUNCTION public.lock_closed_meat_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_audit_only boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' THEN
    v_audit_only :=
      (OLD.planned_total_cost IS DISTINCT FROM NEW.planned_total_cost)
      AND OLD.planned_total_cost IS NULL
      AND (to_jsonb(OLD) - 'planned_total_cost' - 'updated_at')
        = (to_jsonb(NEW) - 'planned_total_cost' - 'updated_at');
    IF NEW.status <> 'closed' THEN
      RAISE EXCEPTION 'BATCH_LOCKED: لا يمكن تعديل دفعة مغلقة. استخدم حركة عكسية.';
    END IF;
    IF NOT v_audit_only AND (to_jsonb(OLD) - 'updated_at') <> (to_jsonb(NEW) - 'updated_at') THEN
      RAISE EXCEPTION 'BATCH_LOCKED: الدفعة مغلقة وأى تعديل يجب أن يتم بحركة عكسية';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.lock_closed_feed_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_audit_only boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' THEN
    v_audit_only :=
      (OLD.planned_total_cost IS DISTINCT FROM NEW.planned_total_cost)
      AND OLD.planned_total_cost IS NULL
      AND (to_jsonb(OLD) - 'planned_total_cost' - 'updated_at')
        = (to_jsonb(NEW) - 'planned_total_cost' - 'updated_at');
    IF NEW.status <> 'closed' THEN
      RAISE EXCEPTION 'BATCH_LOCKED: الدفعة مغلقة وأى تعديل يجب أن يتم بحركة عكسية';
    END IF;
    IF NOT v_audit_only AND (to_jsonb(OLD) - 'updated_at') <> (to_jsonb(NEW) - 'updated_at') THEN
      RAISE EXCEPTION 'BATCH_LOCKED: الدفعة مغلقة وأى تعديل يجب أن يتم بحركة عكسية';
    END IF;
  END IF;
  RETURN NEW;
END $$;

UPDATE public.meat_factory_batches b
SET planned_total_cost = sub.planned_cost
FROM (
  SELECT c.batch_id,
         SUM(COALESCE(c.quantity,0) * COALESCE(c.unit_cost,0))
       + COALESCE((SELECT SUM(COALESCE(p.quantity,0) * COALESCE(p.unit_cost,0))
                   FROM public.meat_factory_batch_packaging p WHERE p.batch_id = c.batch_id), 0) AS planned_cost
  FROM public.meat_factory_batch_consumption c GROUP BY c.batch_id
) sub
WHERE b.id = sub.batch_id AND b.planned_total_cost IS NULL;

UPDATE public.feed_production_batches b
SET planned_total_cost = sub.planned_cost
FROM (
  SELECT batch_id, SUM(COALESCE(quantity,0) * COALESCE(unit_cost,0)) AS planned_cost
  FROM public.feed_batch_consumption GROUP BY batch_id
) sub
WHERE b.id = sub.batch_id AND b.planned_total_cost IS NULL;