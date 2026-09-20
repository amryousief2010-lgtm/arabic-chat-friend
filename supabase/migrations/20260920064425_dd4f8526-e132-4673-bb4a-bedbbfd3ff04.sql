ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.zodex_closed_invoices REPLICA IDENTITY FULL;
ALTER TABLE public.zodex_closed_invoice_orders REPLICA IDENTITY FULL;
ALTER TABLE public.zodex_missing_orders REPLICA IDENTITY FULL;
ALTER TABLE public.zodex_sync_runs REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','zodex_closed_invoices','zodex_closed_invoice_orders','zodex_missing_orders','zodex_sync_runs'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;