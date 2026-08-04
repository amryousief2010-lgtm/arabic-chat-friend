ALTER TABLE public.inventory_items DISABLE TRIGGER trg_redirect_merged_item_stock;

UPDATE public.inventory_items
SET stock = 104.5, is_active = true, updated_at = now()
WHERE id = '1b506655-e6b7-4bcf-98b8-86322b1681d2';

UPDATE public.inventory_items
SET stock = 0, is_active = false, updated_at = now()
WHERE id = '7aa046e6-7398-4f95-af0c-f679d5c27696';

ALTER TABLE public.inventory_items ENABLE TRIGGER trg_redirect_merged_item_stock;