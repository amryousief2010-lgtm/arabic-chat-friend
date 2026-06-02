ALTER TABLE public.warehouse_transfer_items
  DROP CONSTRAINT IF EXISTS warehouse_transfer_items_source_movement_id_fkey,
  DROP CONSTRAINT IF EXISTS warehouse_transfer_items_destination_movement_id_fkey;

ALTER TABLE public.warehouse_transfer_items
  ADD CONSTRAINT warehouse_transfer_items_source_movement_id_fkey
    FOREIGN KEY (source_movement_id) REFERENCES public.inventory_movements(id) ON DELETE SET NULL,
  ADD CONSTRAINT warehouse_transfer_items_destination_movement_id_fkey
    FOREIGN KEY (destination_movement_id) REFERENCES public.inventory_movements(id) ON DELETE SET NULL;