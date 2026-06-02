
CREATE TABLE public.hatch_customer_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.hatch_customers(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  notes TEXT,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hatch_customer_payments_customer ON public.hatch_customer_payments(customer_id);
CREATE INDEX idx_hatch_customer_payments_date ON public.hatch_customer_payments(payment_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hatch_customer_payments TO authenticated;
GRANT ALL ON public.hatch_customer_payments TO service_role;

ALTER TABLE public.hatch_customer_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_hatch_payments" ON public.hatch_customer_payments
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'farm_manager'::app_role,'production_manager'::app_role,'quality_manager'::app_role,'hatchery_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]));

CREATE POLICY "manage_hatch_payments" ON public.hatch_customer_payments
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'farm_manager'::app_role,'production_manager'::app_role,'hatchery_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'farm_manager'::app_role,'production_manager'::app_role,'hatchery_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]));

CREATE TRIGGER trg_hatch_customer_payments_updated
  BEFORE UPDATE ON public.hatch_customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
