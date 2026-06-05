
-- ====== Opening balances ======
CREATE TABLE IF NOT EXISTS public.lab_treasury_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_date date NOT NULL,
  cash_amount numeric NOT NULL DEFAULT 0 CHECK (cash_amount >= 0),
  vodafone_cash_amount numeric NOT NULL DEFAULT 0 CHECK (vodafone_cash_amount >= 0),
  instapay_amount numeric NOT NULL DEFAULT 0 CHECK (instapay_amount >= 0),
  bank_transfer_amount numeric NOT NULL DEFAULT 0 CHECK (bank_transfer_amount >= 0),
  total_amount numeric GENERATED ALWAYS AS (cash_amount + vodafone_cash_amount + instapay_amount + bank_transfer_amount) STORED,
  notes text,
  status lab_treasury_status NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_treasury_opening_balances TO authenticated;
GRANT ALL ON public.lab_treasury_opening_balances TO service_role;
ALTER TABLE public.lab_treasury_opening_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lto_select" ON public.lab_treasury_opening_balances FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'accountant'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role)
);
CREATE POLICY "lto_insert" ON public.lab_treasury_opening_balances FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role)
);
CREATE POLICY "lto_update_managers" ON public.lab_treasury_opening_balances FOR UPDATE TO authenticated
USING (has_role(auth.uid(),'general_manager'::app_role) OR has_role(auth.uid(),'executive_manager'::app_role));
CREATE POLICY "lto_delete_gm" ON public.lab_treasury_opening_balances FOR DELETE TO authenticated
USING (has_role(auth.uid(),'general_manager'::app_role));

-- ====== External collections (عُهَد) ======
DO $$ BEGIN
  CREATE TYPE public.lab_external_status AS ENUM ('not_deposited','partially_deposited','fully_deposited');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.lab_external_source AS ENUM ('hatching','chick_sales','general','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.lab_treasury_external_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_name text NOT NULL,
  payment_method lab_treasury_payment_method NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  source lab_external_source NOT NULL DEFAULT 'general',
  collection_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
  notes text,
  deposited_amount numeric NOT NULL DEFAULT 0 CHECK (deposited_amount >= 0),
  status lab_external_status NOT NULL DEFAULT 'not_deposited',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (deposited_amount <= amount)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_treasury_external_collections TO authenticated;
GRANT ALL ON public.lab_treasury_external_collections TO service_role;
ALTER TABLE public.lab_treasury_external_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lec_select" ON public.lab_treasury_external_collections FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'accountant'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role)
);
CREATE POLICY "lec_insert" ON public.lab_treasury_external_collections FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role)
);
CREATE POLICY "lec_update_managers" ON public.lab_treasury_external_collections FOR UPDATE TO authenticated
USING (has_role(auth.uid(),'general_manager'::app_role) OR has_role(auth.uid(),'executive_manager'::app_role));
CREATE POLICY "lec_delete_gm" ON public.lab_treasury_external_collections FOR DELETE TO authenticated
USING (has_role(auth.uid(),'general_manager'::app_role));

CREATE TABLE IF NOT EXISTS public.lab_treasury_external_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_collection_id uuid NOT NULL REFERENCES public.lab_treasury_external_collections(id) ON DELETE RESTRICT,
  movement_id uuid REFERENCES public.lab_treasury_movements(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method lab_treasury_payment_method NOT NULL,
  deposit_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_treasury_external_deposits TO authenticated;
GRANT ALL ON public.lab_treasury_external_deposits TO service_role;
ALTER TABLE public.lab_treasury_external_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "led_select" ON public.lab_treasury_external_deposits FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'accountant'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role)
);
CREATE POLICY "led_insert" ON public.lab_treasury_external_deposits FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role)
);
CREATE POLICY "led_delete_gm" ON public.lab_treasury_external_deposits FOR DELETE TO authenticated
USING (has_role(auth.uid(),'general_manager'::app_role));

-- Trigger: when deposit created, update collection status + create pending lab_treasury_movement
CREATE OR REPLACE FUNCTION public.lab_external_after_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ext RECORD;
  v_total_deposited numeric;
  v_movement_id uuid;
BEGIN
  SELECT * INTO v_ext FROM public.lab_treasury_external_collections WHERE id = NEW.external_collection_id FOR UPDATE;

  -- create treasury income movement (pending)
  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, income_category, amount, payment_method,
    description, customer_name, notes, status, created_by,
    source_table, source_id, source_ref
  ) VALUES (
    'income', NEW.deposit_date,
    CASE v_ext.source WHEN 'hatching' THEN 'customer_hatching'::lab_treasury_income_category
                      WHEN 'chick_sales' THEN 'chick_sales'::lab_treasury_income_category
                      ELSE 'other_income'::lab_treasury_income_category END,
    NEW.amount, NEW.payment_method,
    'توريد تحصيل خارجي من: ' || v_ext.holder_name,
    v_ext.holder_name, NEW.notes, 'pending', NEW.created_by,
    'lab_treasury_external_deposits', NEW.id,
    'External deposit from ' || v_ext.holder_name
  ) RETURNING id INTO v_movement_id;

  UPDATE public.lab_treasury_external_deposits SET movement_id = v_movement_id WHERE id = NEW.id;

  SELECT COALESCE(SUM(amount),0) INTO v_total_deposited
  FROM public.lab_treasury_external_deposits WHERE external_collection_id = NEW.external_collection_id;

  UPDATE public.lab_treasury_external_collections
  SET deposited_amount = v_total_deposited,
      status = CASE
        WHEN v_total_deposited >= amount THEN 'fully_deposited'::lab_external_status
        WHEN v_total_deposited > 0 THEN 'partially_deposited'::lab_external_status
        ELSE 'not_deposited'::lab_external_status END,
      updated_at = now()
  WHERE id = NEW.external_collection_id;

  -- audit
  BEGIN
    INSERT INTO public.lab_treasury_audit_log (action, movement_id, actor_id, actor_name, after_data, reason)
    VALUES ('external_deposit', v_movement_id, NEW.created_by, 'system', to_jsonb(NEW), 'External deposit created');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lab_external_after_deposit ON public.lab_treasury_external_deposits;
CREATE TRIGGER trg_lab_external_after_deposit
AFTER INSERT ON public.lab_treasury_external_deposits
FOR EACH ROW EXECUTE FUNCTION public.lab_external_after_deposit();

-- Aggregate view for dashboard
CREATE OR REPLACE VIEW public.v_lab_external_summary AS
SELECT
  COALESCE(SUM(amount - deposited_amount),0) AS total_outstanding,
  COALESCE(SUM(amount),0) AS total_collected,
  COALESCE(SUM(deposited_amount),0) AS total_deposited,
  COUNT(*) FILTER (WHERE status <> 'fully_deposited') AS open_count
FROM public.lab_treasury_external_collections;

GRANT SELECT ON public.v_lab_external_summary TO authenticated;
