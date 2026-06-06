GRANT SELECT, INSERT, UPDATE, DELETE ON public.hatch_customers TO authenticated;
GRANT ALL ON public.hatch_customers TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hatch_batches TO authenticated;
GRANT ALL ON public.hatch_batches TO service_role;

GRANT SELECT, INSERT ON public.hatch_batch_import_log TO authenticated;
GRANT ALL ON public.hatch_batch_import_log TO service_role;