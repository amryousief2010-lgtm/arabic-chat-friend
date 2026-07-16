
DO $$
DECLARE
  g RECORD;
  keeper UUID;
  dup UUID;
  keeper_stock NUMERIC;
  total_stock NUMERIC;
BEGIN
  FOR g IN
    SELECT warehouse_id, product_id
    FROM public.inventory_items
    WHERE product_id IS NOT NULL
    GROUP BY warehouse_id, product_id
    HAVING COUNT(*) > 1
  LOOP
    -- pick oldest row as keeper
    SELECT id, stock INTO keeper, keeper_stock
    FROM public.inventory_items
    WHERE warehouse_id = g.warehouse_id AND product_id = g.product_id
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    SELECT COALESCE(SUM(stock),0) INTO total_stock
    FROM public.inventory_items
    WHERE warehouse_id = g.warehouse_id AND product_id = g.product_id;

    -- repoint FKs on the duplicates to the keeper
    FOR dup IN
      SELECT id FROM public.inventory_items
      WHERE warehouse_id = g.warehouse_id AND product_id = g.product_id AND id <> keeper
    LOOP
      UPDATE public.inventory_movements SET item_id = keeper WHERE item_id = dup;
      UPDATE public.slaughter_batch_outputs SET received_inventory_item_id = keeper WHERE received_inventory_item_id = dup;
      UPDATE public.warehouse_transfer_items SET source_item_id = keeper WHERE source_item_id = dup;
      UPDATE public.warehouse_transfer_items SET destination_item_id = keeper WHERE destination_item_id = dup;
      UPDATE public.meat_factory_raw_materials SET inventory_item_id = keeper WHERE inventory_item_id = dup;
      UPDATE public.feed_raw_materials SET inventory_item_id = keeper WHERE inventory_item_id = dup;
      UPDATE public.packaging_materials SET inventory_item_id = keeper WHERE inventory_item_id = dup;
      UPDATE public.meat_factory_products SET inventory_item_id = keeper WHERE inventory_item_id = dup;
      UPDATE public.feed_products SET inventory_item_id = keeper WHERE inventory_item_id = dup;
      UPDATE public.meat_manufacturing_invoices SET finished_item_id = keeper WHERE finished_item_id = dup;
      UPDATE public.stocktaking_lines SET item_id = keeper WHERE item_id = dup;

      DELETE FROM public.inventory_items WHERE id = dup;
    END LOOP;

    -- set keeper stock to the summed total
    UPDATE public.inventory_items SET stock = total_stock WHERE id = keeper;
  END LOOP;
END$$;

-- prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_wh_product_unique
  ON public.inventory_items (warehouse_id, product_id)
  WHERE product_id IS NOT NULL;
