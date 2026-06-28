CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_old_qty numeric; v_old_cost numeric; v_new_cost numeric;
BEGIN
  IF NEW.approval_status <> 'posted' THEN RETURN NEW; END IF;

  -- Increment: receipts, stock_in variants, and opening_balance
  IF NEW.movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return','opening_balance') THEN
    SELECT stock, unit_cost INTO v_old_qty, v_old_cost
      FROM public.inventory_items WHERE id = NEW.item_id FOR UPDATE;
    IF NEW.unit_cost IS NOT NULL AND NEW.unit_cost > 0 AND NEW.quantity > 0 THEN
      v_new_cost := ((COALESCE(v_old_qty,0) * COALESCE(v_old_cost,0)) + (NEW.quantity * NEW.unit_cost))
                    / NULLIF(COALESCE(v_old_qty,0) + NEW.quantity, 0);
      UPDATE public.inventory_items
        SET stock = stock + NEW.quantity,
            unit_cost = COALESCE(v_new_cost, unit_cost),
            last_movement_date = now()
        WHERE id = NEW.item_id;
      IF v_old_cost IS DISTINCT FROM v_new_cost THEN
        INSERT INTO public.product_cost_history(module, target_table, target_id, old_cost, new_cost, reason, source, approved_by)
        VALUES (COALESCE(NEW.module,'shared'),'inventory_items', NEW.item_id::text,
                v_old_cost, v_new_cost, 'متوسط مرجح عند ' || NEW.movement_type, 'inv_post', NEW.performed_by);
      END IF;
    ELSE
      UPDATE public.inventory_items SET stock = stock + NEW.quantity, last_movement_date = now()
        WHERE id = NEW.item_id;
    END IF;

  ELSIF NEW.movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss') THEN
    SELECT (stock - reserved_qty - blocked_qty) INTO v_old_qty
      FROM public.inventory_items WHERE id = NEW.item_id FOR UPDATE;
    IF v_old_qty < NEW.quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_old_qty, NEW.quantity;
    END IF;
    UPDATE public.inventory_items SET stock = stock - NEW.quantity, last_movement_date = now()
      WHERE id = NEW.item_id;

  ELSIF NEW.movement_type = 'transfer' THEN
    SELECT (stock - reserved_qty - blocked_qty) INTO v_old_qty
      FROM public.inventory_items WHERE id = NEW.item_id FOR UPDATE;
    IF v_old_qty < NEW.quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_old_qty, NEW.quantity;
    END IF;
    UPDATE public.inventory_items SET stock = stock - NEW.quantity, last_movement_date = now()
      WHERE id = NEW.item_id;

  ELSIF NEW.movement_type IN ('adjustment','reconciliation') THEN
    UPDATE public.inventory_items SET stock = NEW.quantity, last_movement_date = now()
      WHERE id = NEW.item_id;
  END IF;

  RETURN NEW;
END $function$;