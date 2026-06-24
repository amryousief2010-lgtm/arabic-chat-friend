
CREATE TABLE IF NOT EXISTS public.main_warehouse_treasury_txns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  category TEXT NOT NULL CHECK (category IN (
    'direct_sale_cash','transfer_to_main_treasury','manual_adjust','opening_balance','other'
  )),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  reference TEXT,
  notes TEXT,
  performed_by UUID,
  transfer_id UUID,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','pending_approval','rejected'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.main_warehouse_treasury_txns TO authenticated;
GRANT ALL ON public.main_warehouse_treasury_txns TO service_role;

CREATE OR REPLACE FUNCTION public.set_main_warehouse_treasury_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_main_warehouse_treasury_updated_at ON public.main_warehouse_treasury_txns;
CREATE TRIGGER trg_main_warehouse_treasury_updated_at
  BEFORE UPDATE ON public.main_warehouse_treasury_txns
  FOR EACH ROW EXECUTE FUNCTION public.set_main_warehouse_treasury_updated_at();

ALTER TABLE public.main_warehouse_treasury_txns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MWT read"
  ON public.main_warehouse_treasury_txns FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
    OR public.has_role(auth.uid(), 'financial_manager')
    OR public.has_role(auth.uid(), 'main_treasury_accountant')
    OR public.has_role(auth.uid(), 'main_treasury_approver')
    OR public.has_role(auth.uid(), 'accountant')
    OR public.has_role(auth.uid(), 'warehouse_supervisor')
    OR public.has_role(auth.uid(), 'agouza_warehouse_keeper')
  );

CREATE POLICY "MWT insert"
  ON public.main_warehouse_treasury_txns FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      public.has_role(auth.uid(), 'general_manager')
      OR public.has_role(auth.uid(), 'executive_manager')
      OR public.has_role(auth.uid(), 'financial_manager')
      OR public.has_role(auth.uid(), 'main_treasury_accountant')
      OR public.has_role(auth.uid(), 'warehouse_supervisor')
    )
    AND (performed_by IS NULL OR performed_by = auth.uid())
  );

CREATE POLICY "MWT update"
  ON public.main_warehouse_treasury_txns FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
    OR public.has_role(auth.uid(), 'financial_manager')
    OR public.has_role(auth.uid(), 'main_treasury_approver')
    OR performed_by = auth.uid()
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
    OR public.has_role(auth.uid(), 'financial_manager')
    OR public.has_role(auth.uid(), 'main_treasury_approver')
    OR performed_by = auth.uid()
  );

CREATE POLICY "MWT delete"
  ON public.main_warehouse_treasury_txns FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'general_manager'));

CREATE INDEX IF NOT EXISTS idx_mwt_performed_at ON public.main_warehouse_treasury_txns(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mwt_status ON public.main_warehouse_treasury_txns(status);
CREATE INDEX IF NOT EXISTS idx_mwt_transfer_id ON public.main_warehouse_treasury_txns(transfer_id);
