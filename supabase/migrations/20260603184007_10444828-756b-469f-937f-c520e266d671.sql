-- Hatchery Treasury (independent cash box for the hatchery)
CREATE TABLE IF NOT EXISTS public.hatchery_treasury_txns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date date NOT NULL DEFAULT CURRENT_DATE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  category text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  customer_id uuid REFERENCES public.hatch_customers(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES public.hatch_batches(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hatchery_treasury_txns TO authenticated;
GRANT ALL ON public.hatchery_treasury_txns TO service_role;

ALTER TABLE public.hatchery_treasury_txns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hatchery treasury read" ON public.hatchery_treasury_txns FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'general_manager')
  OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'hatchery_manager')
  OR public.has_role(auth.uid(),'production_manager')
  OR public.has_role(auth.uid(),'financial_manager')
  OR public.has_role(auth.uid(),'accountant')
);

CREATE POLICY "Hatchery treasury write" ON public.hatchery_treasury_txns FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'general_manager')
  OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'hatchery_manager')
  OR public.has_role(auth.uid(),'production_manager')
);

CREATE POLICY "Hatchery treasury update" ON public.hatchery_treasury_txns FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(),'general_manager')
  OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'hatchery_manager')
);

CREATE POLICY "Hatchery treasury delete" ON public.hatchery_treasury_txns FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(),'general_manager')
  OR public.has_role(auth.uid(),'executive_manager')
);

CREATE INDEX IF NOT EXISTS idx_hatch_treasury_date ON public.hatchery_treasury_txns(txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_hatch_treasury_dir ON public.hatchery_treasury_txns(direction);

CREATE OR REPLACE FUNCTION public.touch_hatchery_treasury() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_touch_hatchery_treasury ON public.hatchery_treasury_txns;
CREATE TRIGGER trg_touch_hatchery_treasury BEFORE UPDATE ON public.hatchery_treasury_txns
FOR EACH ROW EXECUTE FUNCTION public.touch_hatchery_treasury();