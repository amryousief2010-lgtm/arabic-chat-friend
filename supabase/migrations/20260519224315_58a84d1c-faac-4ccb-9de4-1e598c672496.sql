-- Snapshot original product price per offer line so each offer keeps its own prices independently
ALTER TABLE public.offer_box_items
  ADD COLUMN IF NOT EXISTS original_price numeric;

-- Backfill existing rows from current product price
UPDATE public.offer_box_items oi
SET original_price = p.price
FROM public.products p
WHERE oi.product_id = p.id AND oi.original_price IS NULL;

-- Trigger to auto-snapshot product price on insert if not provided
CREATE OR REPLACE FUNCTION public.snapshot_offer_item_original_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.original_price IS NULL THEN
    SELECT price INTO NEW.original_price FROM public.products WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_offer_item_price ON public.offer_box_items;
CREATE TRIGGER trg_snapshot_offer_item_price
BEFORE INSERT ON public.offer_box_items
FOR EACH ROW EXECUTE FUNCTION public.snapshot_offer_item_original_price();