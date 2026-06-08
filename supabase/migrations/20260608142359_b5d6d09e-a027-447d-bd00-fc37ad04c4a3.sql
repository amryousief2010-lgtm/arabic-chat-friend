
CREATE TABLE public.lab_customer_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.hatch_customers(id) ON DELETE RESTRICT,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('batch_charge','collection','discount','internal_settlement','adjustment','reversal','opening_balance','historical_closeout')),
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL DEFAULT gen_random_uuid(),
  batch_number TEXT,
  operational_batch_no INTEGER,
  infertile_eggs INTEGER DEFAULT 0,
  candle2_dead INTEGER DEFAULT 0,
  chicks INTEGER DEFAULT 0,
  brooding_chicks INTEGER DEFAULT 0,
  brooding_days INTEGER DEFAULT 0,
  infertile_price NUMERIC(12,2) DEFAULT 50,
  candle2_price NUMERIC(12,2) DEFAULT 100,
  chick_price NUMERIC(12,2) DEFAULT 150,
  brooding_price NUMERIC(12,2) DEFAULT 10,
  subtotal NUMERIC(14,2) DEFAULT 0,
  discount NUMERIC(14,2) DEFAULT 0,
  debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  running_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method TEXT,
  receipt_no TEXT,
  description TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lab_ledger_source UNIQUE (source_type, source_id, customer_id)
);
CREATE INDEX idx_lab_ledger_customer_date ON public.lab_customer_ledger(customer_id, entry_date, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_customer_ledger TO authenticated;
GRANT ALL ON public.lab_customer_ledger TO service_role;
ALTER TABLE public.lab_customer_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab_ledger_read" ON public.lab_customer_ledger FOR SELECT TO authenticated USING (
  has_role(auth.uid(),'general_manager'::app_role) OR has_role(auth.uid(),'executive_manager'::app_role)
  OR has_role(auth.uid(),'accountant'::app_role) OR has_role(auth.uid(),'financial_manager'::app_role)
  OR has_role(auth.uid(),'lab_treasury_keeper'::app_role)
);
CREATE POLICY "lab_ledger_write_gm" ON public.lab_customer_ledger FOR ALL TO authenticated USING (
  has_role(auth.uid(),'general_manager'::app_role) OR has_role(auth.uid(),'executive_manager'::app_role)
) WITH CHECK (
  has_role(auth.uid(),'general_manager'::app_role) OR has_role(auth.uid(),'executive_manager'::app_role)
);

CREATE TABLE public.lab_customer_ledger_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID, customer_id UUID, action TEXT NOT NULL,
  old_data JSONB, new_data JSONB, reason TEXT,
  changed_by UUID, changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.lab_customer_ledger_audit TO authenticated;
GRANT ALL ON public.lab_customer_ledger_audit TO service_role;
ALTER TABLE public.lab_customer_ledger_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab_ledger_audit_read" ON public.lab_customer_ledger_audit FOR SELECT TO authenticated USING (
  has_role(auth.uid(),'general_manager'::app_role) OR has_role(auth.uid(),'executive_manager'::app_role)
  OR has_role(auth.uid(),'accountant'::app_role) OR has_role(auth.uid(),'financial_manager'::app_role)
);

CREATE OR REPLACE FUNCTION public.lab_ledger_recompute_balance(p_customer UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r RECORD; bal NUMERIC := 0;
BEGIN
  FOR r IN SELECT id, debit, credit FROM public.lab_customer_ledger
           WHERE customer_id=p_customer ORDER BY entry_date, created_at, id LOOP
    bal := bal + COALESCE(r.debit,0) - COALESCE(r.credit,0);
    UPDATE public.lab_customer_ledger SET running_balance=bal WHERE id=r.id;
  END LOOP;
END; $$;

CREATE OR REPLACE VIEW public.v_lab_customer_balances AS
SELECT
  c.id AS customer_id, c.name, c.customer_type,
  COALESCE(SUM(l.debit),0) AS total_debit,
  COALESCE(SUM(l.credit),0) AS total_credit,
  COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0) AS balance,
  COUNT(*) FILTER (WHERE l.entry_type='batch_charge') AS batches_count,
  MAX(l.entry_date) FILTER (WHERE l.entry_type='batch_charge') AS last_batch_date,
  MAX(l.entry_date) FILTER (WHERE l.entry_type IN ('collection','internal_settlement','historical_closeout')) AS last_payment_date,
  CASE
    WHEN COUNT(l.id)=0 THEN 'no_activity'
    WHEN COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0) = 0 THEN 'settled'
    WHEN COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0) < 0 THEN 'credit_balance'
    WHEN COALESCE(SUM(l.credit),0) > 0 THEN 'partially_paid'
    ELSE 'outstanding'
  END AS account_status
FROM public.hatch_customers c
LEFT JOIN public.lab_customer_ledger l ON l.customer_id=c.id
WHERE c.is_active=true AND c.is_test=false
GROUP BY c.id, c.name, c.customer_type;
GRANT SELECT ON public.v_lab_customer_balances TO authenticated;
