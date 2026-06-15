
-- 1. Operational start date per warehouse
ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS operational_start_date DATE;

-- 2. Enforcement trigger on inventory_movements
CREATE OR REPLACE FUNCTION public.enforce_warehouse_operational_start()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start_date DATE;
  _is_decrement boolean;
BEGIN
  -- Detect decrement movements on the source warehouse
  _is_decrement := (
    NEW.movement_type IN ('out','transfer')
    OR (NEW.movement_type = 'adjustment' AND COALESCE(NEW.quantity, 0) < 0)
  );

  IF NOT _is_decrement THEN
    RETURN NEW;
  END IF;

  SELECT operational_start_date INTO _start_date
    FROM public.warehouses
   WHERE id = NEW.warehouse_id;

  -- No date set → no enforcement (legacy/uncontrolled warehouses keep working)
  IF _start_date IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.performed_at, now())::date < _start_date THEN
    RAISE EXCEPTION USING
      MESSAGE = 'هذه الحركة قبل تاريخ بداية التشغيل الفعلي للمخزون، ولن تؤثر على الرصيد. برجاء تسجيل رصيد افتتاحي أولًا.',
      ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_warehouse_op_start ON public.inventory_movements;
CREATE TRIGGER trg_enforce_warehouse_op_start
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_warehouse_operational_start();
