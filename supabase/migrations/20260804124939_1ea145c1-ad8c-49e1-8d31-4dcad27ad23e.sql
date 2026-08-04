CREATE OR REPLACE FUNCTION public.reactivate_destination_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approval_status = 'posted'
     AND NEW.movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return','opening_balance')
     AND NEW.quantity > 0 THEN
    UPDATE public.inventory_items
       SET is_active = true
     WHERE id = NEW.item_id AND is_active = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reactivate_destination_item ON public.inventory_movements;
CREATE TRIGGER trg_reactivate_destination_item
AFTER INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.reactivate_destination_item();