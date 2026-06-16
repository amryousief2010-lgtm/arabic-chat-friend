
ALTER TABLE public.meat_factory_raw_items
  ADD COLUMN IF NOT EXISTS code text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meat_raw_items_code
  ON public.meat_factory_raw_items(code) WHERE code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meat_moves_opening_balance
  ON public.meat_factory_inventory_moves(ref_table, item_id, direction)
  WHERE ref_table = 'opening_balance';
