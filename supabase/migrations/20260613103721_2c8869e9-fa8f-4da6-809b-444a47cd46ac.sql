
ALTER TABLE public.meat_factory_inventory_moves
  DROP CONSTRAINT IF EXISTS meat_factory_inventory_moves_item_kind_check;
ALTER TABLE public.meat_factory_inventory_moves
  ADD CONSTRAINT meat_factory_inventory_moves_item_kind_check
  CHECK (item_kind = ANY (ARRAY['raw'::text, 'spice'::text, 'packaging'::text, 'finished'::text]));
