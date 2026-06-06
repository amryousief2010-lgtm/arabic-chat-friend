ALTER TABLE public.import_staging_runs DROP CONSTRAINT import_staging_runs_import_type_check;
ALTER TABLE public.import_staging_runs ADD CONSTRAINT import_staging_runs_import_type_check
  CHECK (import_type = ANY (ARRAY['products','meat_stock','feed_stock','packaging','meat_invoices','feed_invoices','meat_bom','feed_bom','hatchery_workbook']));