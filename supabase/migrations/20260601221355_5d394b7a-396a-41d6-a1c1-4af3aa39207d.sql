
-- Reverse inventory stock changes when a movement is deleted or its quantity edited.
CREATE OR REPLACE FUNCTION public.reverse_inventory_movement_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.approval_status IS DISTINCT FROM 'posted' THEN
    RETURN OLD;
  END IF;

  IF OLD.movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return') THEN
    UPDATE public.inventory_items
      SET stock = GREATEST(stock - OLD.quantity, 0),
          last_movement_date = now()
      WHERE id = OLD.item_id;
  ELSIF OLD.movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss','transfer') THEN
    UPDATE public.inventory_items
      SET stock = stock + OLD.quantity,
          last_movement_date = now()
      WHERE id = OLD.item_id;
  END IF;

  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_reverse_inventory_movement_del ON public.inventory_movements;
CREATE TRIGGER trg_reverse_inventory_movement_del
BEFORE DELETE ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.reverse_inventory_movement_on_delete();


CREATE OR REPLACE FUNCTION public.adjust_inventory_movement_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE delta numeric;
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'posted' OR OLD.approval_status IS DISTINCT FROM 'posted' THEN
    RETURN NEW;
  END IF;
  IF NEW.item_id <> OLD.item_id OR NEW.movement_type <> OLD.movement_type THEN
    -- Reverse old fully then apply new (simple path)
    IF OLD.movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return') THEN
      UPDATE public.inventory_items SET stock = GREATEST(stock - OLD.quantity, 0) WHERE id = OLD.item_id;
    ELSIF OLD.movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss','transfer') THEN
      UPDATE public.inventory_items SET stock = stock + OLD.quantity WHERE id = OLD.item_id;
    END IF;
    IF NEW.movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return') THEN
      UPDATE public.inventory_items SET stock = stock + NEW.quantity, last_movement_date = now() WHERE id = NEW.item_id;
    ELSIF NEW.movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss','transfer') THEN
      UPDATE public.inventory_items SET stock = GREATEST(stock - NEW.quantity, 0), last_movement_date = now() WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
  END IF;

  delta := COALESCE(NEW.quantity,0) - COALESCE(OLD.quantity,0);
  IF delta = 0 THEN RETURN NEW; END IF;

  IF NEW.movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return') THEN
    UPDATE public.inventory_items
      SET stock = GREATEST(stock + delta, 0), last_movement_date = now()
      WHERE id = NEW.item_id;
  ELSIF NEW.movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss','transfer') THEN
    UPDATE public.inventory_items
      SET stock = GREATEST(stock - delta, 0), last_movement_date = now()
      WHERE id = NEW.item_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_adjust_inventory_movement_upd ON public.inventory_movements;
CREATE TRIGGER trg_adjust_inventory_movement_upd
AFTER UPDATE OF quantity, item_id, movement_type ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.adjust_inventory_movement_on_update();
