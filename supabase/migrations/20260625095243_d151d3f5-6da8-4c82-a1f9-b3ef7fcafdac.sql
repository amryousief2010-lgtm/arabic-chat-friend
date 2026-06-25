
-- Priority 1: Auto-treasury txn on cash_collect + order status sync + bonus/return reference value

-- 1) Trigger: auto-create main_warehouse_treasury_txns when cash_collect line is inserted
CREATE OR REPLACE FUNCTION public.auto_main_warehouse_treasury_on_cash_collect()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_courier text;
  v_ref text;
BEGIN
  IF NEW.line_type <> 'cash_collect' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.cash_collected, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_ref := 'auto-line:' || NEW.id::text;

  -- idempotent guard
  IF EXISTS (SELECT 1 FROM public.main_warehouse_treasury_txns WHERE reference = v_ref) THEN
    RETURN NEW;
  END IF;

  SELECT courier_name INTO v_courier FROM public.courier_goods_custodies WHERE id = NEW.custody_id;

  INSERT INTO public.main_warehouse_treasury_txns(
    direction, category, amount, reference, notes, performed_by, status, courier_name, performed_at
  ) VALUES (
    'in', 'courier_deposit', NEW.cash_collected, v_ref,
    'تحصيل تلقائي من سطر عهدة #' || NEW.id::text,
    NEW.performed_by, 'posted', v_courier, COALESCE(NEW.performed_at, now())
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_main_warehouse_treasury_on_cash_collect ON public.courier_goods_custody_lines;
CREATE TRIGGER trg_auto_main_warehouse_treasury_on_cash_collect
AFTER INSERT ON public.courier_goods_custody_lines
FOR EACH ROW EXECUTE FUNCTION public.auto_main_warehouse_treasury_on_cash_collect();

-- 2) BEFORE trigger: compute reference total_value for bonus/return when missing
CREATE OR REPLACE FUNCTION public.compute_courier_line_reference_value()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_price numeric;
BEGIN
  IF NEW.line_type IN ('bonus', 'return') THEN
    IF COALESCE(NEW.total_value, 0) = 0 THEN
      v_price := COALESCE(NEW.unit_price, NEW.original_price, 0);
      NEW.total_value := COALESCE(NEW.quantity, 0) * v_price;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_courier_line_reference_value ON public.courier_goods_custody_lines;
CREATE TRIGGER trg_compute_courier_line_reference_value
BEFORE INSERT OR UPDATE ON public.courier_goods_custody_lines
FOR EACH ROW EXECUTE FUNCTION public.compute_courier_line_reference_value();

-- 3) Trigger: sync orders.status from courier_order_assignments.status
CREATE OR REPLACE FUNCTION public.sync_order_status_from_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_status text;
BEGIN
  IF NEW.order_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_new_status := CASE NEW.status
    WHEN 'completed'          THEN 'completed'
    WHEN 'collected'          THEN 'completed'
    WHEN 'fully_returned'     THEN 'returned'
    WHEN 'partially_returned' THEN 'partially_completed'
    ELSE NULL
  END;

  IF v_new_status IS NOT NULL THEN
    UPDATE public.orders SET status = v_new_status, updated_at = now()
    WHERE id = NEW.order_id AND status IS DISTINCT FROM v_new_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_status_from_assignment ON public.courier_order_assignments;
CREATE TRIGGER trg_sync_order_status_from_assignment
AFTER INSERT OR UPDATE OF status ON public.courier_order_assignments
FOR EACH ROW EXECUTE FUNCTION public.sync_order_status_from_assignment();
