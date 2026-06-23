
CREATE TABLE public.lab_treasury_external_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party text NOT NULL CHECK (party IN ('main_treasury','slaughter_custody','other')),
  party_label text,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  paid_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid')),
  notes text,
  source_type text,
  source_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_treasury_external_receivables TO authenticated;
GRANT ALL ON public.lab_treasury_external_receivables TO service_role;

ALTER TABLE public.lab_treasury_external_receivables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ltr_select" ON public.lab_treasury_external_receivables FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role) OR
  has_role(auth.uid(),'slaughterhouse_manager'::app_role) OR
  has_role(auth.uid(),'slaughterhouse_custody_keeper'::app_role) OR
  has_role(auth.uid(),'accountant'::app_role) OR
  has_role(auth.uid(),'financial_manager'::app_role)
);
CREATE POLICY "ltr_write" ON public.lab_treasury_external_receivables FOR ALL TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role)
)
WITH CHECK (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role)
);

CREATE TABLE public.lab_treasury_external_receivable_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id uuid NOT NULL REFERENCES public.lab_treasury_external_receivables(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  settlement_date date NOT NULL DEFAULT CURRENT_DATE,
  destination_treasury text NOT NULL DEFAULT 'lab' CHECK (destination_treasury IN ('lab','main_treasury','slaughter_custody','other')),
  payment_method text NOT NULL DEFAULT 'cash',
  notes text,
  lab_movement_id uuid REFERENCES public.lab_treasury_movements(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_treasury_external_receivable_settlements TO authenticated;
GRANT ALL ON public.lab_treasury_external_receivable_settlements TO service_role;

ALTER TABLE public.lab_treasury_external_receivable_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ltrs_select" ON public.lab_treasury_external_receivable_settlements FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role) OR
  has_role(auth.uid(),'slaughterhouse_manager'::app_role) OR
  has_role(auth.uid(),'slaughterhouse_custody_keeper'::app_role) OR
  has_role(auth.uid(),'accountant'::app_role) OR
  has_role(auth.uid(),'financial_manager'::app_role)
);
CREATE POLICY "ltrs_write" ON public.lab_treasury_external_receivable_settlements FOR ALL TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role)
)
WITH CHECK (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role)
);

CREATE OR REPLACE FUNCTION public.ltr_recalc_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rid uuid;
  total numeric;
  paid numeric;
  new_status text;
BEGIN
  rid := COALESCE(NEW.receivable_id, OLD.receivable_id);
  SELECT amount INTO total FROM public.lab_treasury_external_receivables WHERE id = rid;
  SELECT COALESCE(SUM(amount),0) INTO paid FROM public.lab_treasury_external_receivable_settlements WHERE receivable_id = rid;
  IF paid <= 0 THEN new_status := 'unpaid';
  ELSIF paid >= total THEN new_status := 'paid';
  ELSE new_status := 'partial';
  END IF;
  UPDATE public.lab_treasury_external_receivables
    SET paid_amount = paid, status = new_status, updated_at = now()
    WHERE id = rid;
  RETURN NULL;
END;
$$;

CREATE TRIGGER ltr_recalc_after_settle
AFTER INSERT OR UPDATE OR DELETE ON public.lab_treasury_external_receivable_settlements
FOR EACH ROW EXECUTE FUNCTION public.ltr_recalc_paid();

CREATE INDEX idx_ltr_status ON public.lab_treasury_external_receivables(status);
CREATE INDEX idx_ltr_party ON public.lab_treasury_external_receivables(party);
CREATE INDEX idx_ltrs_receivable ON public.lab_treasury_external_receivable_settlements(receivable_id);
