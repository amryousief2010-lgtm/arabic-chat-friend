
ALTER TABLE public.meat_manufacturing_invoice_lines
  DROP CONSTRAINT IF EXISTS meat_manufacturing_invoice_lines_item_id_fkey;

ALTER TABLE public.meat_manufacturing_invoice_lines
  ADD CONSTRAINT meat_manufacturing_invoice_lines_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES public.meat_factory_raw_items(id) ON DELETE RESTRICT;
