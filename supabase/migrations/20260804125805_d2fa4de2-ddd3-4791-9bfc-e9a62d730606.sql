-- 1) Guard: redirect stock changes on merged (duplicate) item cards to the canonical card
CREATE OR REPLACE FUNCTION public.redirect_merged_item_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical uuid;
  v_delta numeric;
BEGIN
  SELECT canonical_item_id INTO v_canonical
  FROM public.inventory_item_merge_log
  WHERE source_item_id = NEW.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_canonical IS NULL OR v_canonical = NEW.id THEN
    RETURN NEW;
  END IF;

  v_delta := COALESCE(NEW.stock, 0) - COALESCE(OLD.stock, 0);
  IF v_delta <> 0 THEN
    UPDATE public.inventory_items
    SET stock = stock + v_delta, is_active = true, updated_at = now()
    WHERE id = v_canonical;
  END IF;

  NEW.stock := OLD.stock;
  NEW.is_active := false;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_redirect_merged_item_stock ON public.inventory_items;
CREATE TRIGGER trg_redirect_merged_item_stock
BEFORE UPDATE OF stock ON public.inventory_items
FOR EACH ROW
WHEN (OLD.stock IS DISTINCT FROM NEW.stock)
EXECUTE FUNCTION public.redirect_merged_item_stock();

-- 2) Guard: redirect movements logged against merged cards
CREATE OR REPLACE FUNCTION public.redirect_merged_item_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical uuid;
BEGIN
  SELECT canonical_item_id INTO v_canonical
  FROM public.inventory_item_merge_log
  WHERE source_item_id = NEW.item_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_canonical IS NOT NULL AND v_canonical <> NEW.item_id THEN
    NEW.item_id := v_canonical;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_redirect_merged_item_movement ON public.inventory_movements;
CREATE TRIGGER trg_redirect_merged_item_movement
BEFORE INSERT ON public.inventory_movements
FOR EACH ROW
EXECUTE FUNCTION public.redirect_merged_item_movement();

-- 3) Data fix: move the 64.5 kg that landed on the duplicate "كفتة نعام" card to canonical "كفتة"
UPDATE public.inventory_movements
SET item_id = '1b506655-e6b7-4bcf-98b8-86322b1681d2'
WHERE item_id = '7aa046e6-7398-4f95-af0c-f679d5c27696'
  AND warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c';

UPDATE public.inventory_items
SET stock = stock + 64.5, is_active = true, updated_at = now()
WHERE id = '1b506655-e6b7-4bcf-98b8-86322b1681d2';

UPDATE public.inventory_items
SET stock = 0, is_active = false, updated_at = now()
WHERE id = '7aa046e6-7398-4f95-af0c-f679d5c27696';