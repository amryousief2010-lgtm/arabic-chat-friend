UPDATE public.inventory_sublocation_items t
SET stock = COALESCE(t.stock,0) + COALESCE(f.stock,0), updated_at = now()
FROM public.inventory_sublocation_items f
WHERE f.sublocation_id = '5bd3c7af-d32c-4d4b-a268-aab438de2127'
  AND t.sublocation_id = '0fc8b6bd-5271-404d-a716-bd3e5df86859'
  AND t.product_id = f.product_id;

UPDATE public.inventory_sublocation_items f
SET sublocation_id = '0fc8b6bd-5271-404d-a716-bd3e5df86859', updated_at = now()
WHERE f.sublocation_id = '5bd3c7af-d32c-4d4b-a268-aab438de2127'
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_sublocation_items t
    WHERE t.sublocation_id = '0fc8b6bd-5271-404d-a716-bd3e5df86859'
      AND t.product_id = f.product_id
  );

DELETE FROM public.inventory_sublocation_items
WHERE sublocation_id = '5bd3c7af-d32c-4d4b-a268-aab438de2127';

UPDATE public.sublocation_movements
SET from_sublocation_id = '0fc8b6bd-5271-404d-a716-bd3e5df86859'
WHERE from_sublocation_id = '5bd3c7af-d32c-4d4b-a268-aab438de2127';

UPDATE public.sublocation_movements
SET to_sublocation_id = '0fc8b6bd-5271-404d-a716-bd3e5df86859'
WHERE to_sublocation_id = '5bd3c7af-d32c-4d4b-a268-aab438de2127';

DELETE FROM public.warehouse_sublocations
WHERE id = '5bd3c7af-d32c-4d4b-a268-aab438de2127';