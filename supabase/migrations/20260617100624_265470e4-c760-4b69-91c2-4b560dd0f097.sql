
CREATE TABLE IF NOT EXISTS public.feed_historical_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id TEXT NOT NULL UNIQUE,
  record_type TEXT NOT NULL CHECK (record_type IN ('purchase','external_sale','internal_sale')),
  feed_type TEXT,
  sale_type TEXT,
  destination TEXT,
  voucher_date DATE,
  voucher_no TEXT,
  document_no TEXT,
  voucher_type TEXT,
  description TEXT,
  counterparty TEXT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'EGP',
  source_file TEXT,
  source_system TEXT DEFAULT 'المحتسب',
  is_historical_reference BOOLEAN NOT NULL DEFAULT TRUE,
  affects_inventory BOOLEAN NOT NULL DEFAULT FALSE,
  affects_treasury BOOLEAN NOT NULL DEFAULT FALSE,
  affects_avg_cost BOOLEAN NOT NULL DEFAULT FALSE,
  affects_debt BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  imported_by UUID,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fhr_record_type ON public.feed_historical_reference(record_type);
CREATE INDEX IF NOT EXISTS idx_fhr_voucher_date ON public.feed_historical_reference(voucher_date);
CREATE INDEX IF NOT EXISTS idx_fhr_feed_type ON public.feed_historical_reference(feed_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_historical_reference TO authenticated;
GRANT ALL ON public.feed_historical_reference TO service_role;

ALTER TABLE public.feed_historical_reference ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feed_hist_ref_view"
  ON public.feed_historical_reference FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager') OR
    public.has_role(auth.uid(),'feed_factory_manager') OR
    public.has_role(auth.uid(),'production_manager') OR
    public.has_role(auth.uid(),'accountant') OR
    public.has_role(auth.uid(),'financial_manager')
  );

CREATE POLICY "feed_hist_ref_write"
  ON public.feed_historical_reference FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager') OR
    public.has_role(auth.uid(),'feed_factory_manager') OR
    public.has_role(auth.uid(),'accountant') OR
    public.has_role(auth.uid(),'financial_manager')
  );

CREATE POLICY "feed_hist_ref_update"
  ON public.feed_historical_reference FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager') OR
    public.has_role(auth.uid(),'feed_factory_manager') OR
    public.has_role(auth.uid(),'accountant') OR
    public.has_role(auth.uid(),'financial_manager')
  );

CREATE POLICY "feed_hist_ref_delete"
  ON public.feed_historical_reference FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager') OR
    public.has_role(auth.uid(),'feed_factory_manager')
  );

CREATE TRIGGER feed_hist_ref_set_updated
  BEFORE UPDATE ON public.feed_historical_reference
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
