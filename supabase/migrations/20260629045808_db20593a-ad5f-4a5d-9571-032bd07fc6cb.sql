
-- ============================================================
-- M1: Agouza Warehouse - Foundation (Tables, RLS, Security)
-- WAREHOUSE_ID: a970d469-37df-40e1-b99f-a49195a3778e
-- ROLE: agouza_warehouse_keeper (already in app_role enum)
-- SCOPE: schema only. No data changes. No stock changes.
-- ============================================================

-- ---------- Security definer helpers ----------
CREATE OR REPLACE FUNCTION public.is_agouza_keeper(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role = 'agouza_warehouse_keeper'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_agouza(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_uid, 'general_manager')
    OR public.has_role(_uid, 'executive_manager')
    OR public.has_role(_uid, 'agouza_warehouse_keeper');
$$;

CREATE OR REPLACE FUNCTION public.can_approve_agouza(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_uid, 'general_manager')
    OR public.has_role(_uid, 'executive_manager');
$$;

-- ============================================================
-- 1) agouza_warehouse_treasury_txns
-- ============================================================
CREATE TABLE public.agouza_warehouse_treasury_txns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_no text UNIQUE,
  txn_date timestamptz NOT NULL DEFAULT now(),
  txn_type text NOT NULL CHECK (txn_type IN (
    'opening_balance','sale','cash_in','cash_out','expense',
    'handover_to_main','handover_returned','adjustment','other'
  )),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  balance_after numeric(14,2),
  customer_name text,
  customer_phone text,
  inventory_item_id uuid,
  product_id uuid,
  quantity numeric(14,3),
  unit_price numeric(14,2),
  reference text,
  related_handover_id uuid,
  notes text,
  closure_id uuid,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agouza_treas_date ON public.agouza_warehouse_treasury_txns(txn_date DESC);
CREATE INDEX idx_agouza_treas_type ON public.agouza_warehouse_treasury_txns(txn_type);
CREATE INDEX idx_agouza_treas_closure ON public.agouza_warehouse_treasury_txns(closure_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agouza_warehouse_treasury_txns TO authenticated;
GRANT ALL ON public.agouza_warehouse_treasury_txns TO service_role;

ALTER TABLE public.agouza_warehouse_treasury_txns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agouza_treas_select" ON public.agouza_warehouse_treasury_txns
  FOR SELECT TO authenticated
  USING (public.can_manage_agouza(auth.uid()));

CREATE POLICY "agouza_treas_insert" ON public.agouza_warehouse_treasury_txns
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_agouza(auth.uid()));

CREATE POLICY "agouza_treas_update" ON public.agouza_warehouse_treasury_txns
  FOR UPDATE TO authenticated
  USING (public.can_approve_agouza(auth.uid()))
  WITH CHECK (public.can_approve_agouza(auth.uid()));

CREATE POLICY "agouza_treas_delete" ON public.agouza_warehouse_treasury_txns
  FOR DELETE TO authenticated
  USING (public.can_approve_agouza(auth.uid()));

-- ============================================================
-- 2) agouza_warehouse_reconciliations
-- ============================================================
CREATE TABLE public.agouza_warehouse_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recon_no text UNIQUE,
  recon_date date NOT NULL DEFAULT CURRENT_DATE,
  recon_kind text NOT NULL CHECK (recon_kind IN ('treasury','stock','both')),
  system_balance numeric(14,2),
  actual_balance numeric(14,2),
  variance numeric(14,2),
  stock_lines jsonb,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  submitted_by uuid REFERENCES auth.users(id),
  submitted_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  rejected_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agouza_recon_date ON public.agouza_warehouse_reconciliations(recon_date DESC);
CREATE INDEX idx_agouza_recon_status ON public.agouza_warehouse_reconciliations(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agouza_warehouse_reconciliations TO authenticated;
GRANT ALL ON public.agouza_warehouse_reconciliations TO service_role;

ALTER TABLE public.agouza_warehouse_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agouza_recon_select" ON public.agouza_warehouse_reconciliations
  FOR SELECT TO authenticated USING (public.can_manage_agouza(auth.uid()));
CREATE POLICY "agouza_recon_insert" ON public.agouza_warehouse_reconciliations
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_agouza(auth.uid()));
CREATE POLICY "agouza_recon_update" ON public.agouza_warehouse_reconciliations
  FOR UPDATE TO authenticated
  USING (public.can_manage_agouza(auth.uid()))
  WITH CHECK (public.can_manage_agouza(auth.uid()));
CREATE POLICY "agouza_recon_delete" ON public.agouza_warehouse_reconciliations
  FOR DELETE TO authenticated USING (public.can_approve_agouza(auth.uid()));

-- ============================================================
-- 3) agouza_daily_closures
-- ============================================================
CREATE TABLE public.agouza_daily_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_date date NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','reopened')),
  opening_treasury numeric(14,2) NOT NULL DEFAULT 0,
  total_sales numeric(14,2) NOT NULL DEFAULT 0,
  total_cash_in numeric(14,2) NOT NULL DEFAULT 0,
  total_cash_out numeric(14,2) NOT NULL DEFAULT 0,
  total_expenses numeric(14,2) NOT NULL DEFAULT 0,
  total_handover numeric(14,2) NOT NULL DEFAULT 0,
  closing_treasury numeric(14,2) NOT NULL DEFAULT 0,
  expected_treasury numeric(14,2) NOT NULL DEFAULT 0,
  variance numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  closed_by uuid REFERENCES auth.users(id),
  closed_at timestamptz,
  reopened_by uuid REFERENCES auth.users(id),
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agouza_closures_date ON public.agouza_daily_closures(closure_date DESC);
CREATE INDEX idx_agouza_closures_status ON public.agouza_daily_closures(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agouza_daily_closures TO authenticated;
GRANT ALL ON public.agouza_daily_closures TO service_role;

ALTER TABLE public.agouza_daily_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agouza_closure_select" ON public.agouza_daily_closures
  FOR SELECT TO authenticated USING (public.can_manage_agouza(auth.uid()));
CREATE POLICY "agouza_closure_insert" ON public.agouza_daily_closures
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_agouza(auth.uid()));
CREATE POLICY "agouza_closure_update" ON public.agouza_daily_closures
  FOR UPDATE TO authenticated
  USING (public.can_manage_agouza(auth.uid()))
  WITH CHECK (public.can_manage_agouza(auth.uid()));
CREATE POLICY "agouza_closure_delete" ON public.agouza_daily_closures
  FOR DELETE TO authenticated USING (public.can_approve_agouza(auth.uid()));

-- ============================================================
-- 4) agouza_stock_reservations
--    Reservations DO NOT affect inventory_items stock.
--    Available = actual_stock - SUM(active reservations).
-- ============================================================
CREATE TABLE public.agouza_stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  product_id uuid,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','committed','expired')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  reserved_by uuid REFERENCES auth.users(id),
  released_at timestamptz,
  released_by uuid REFERENCES auth.users(id),
  release_reason text,
  committed_at timestamptz,
  committed_movement_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- one ACTIVE reservation per (order, item)
CREATE UNIQUE INDEX uq_agouza_reserv_active_order_item
  ON public.agouza_stock_reservations(order_id, inventory_item_id)
  WHERE status = 'active';

CREATE INDEX idx_agouza_reserv_item ON public.agouza_stock_reservations(inventory_item_id) WHERE status = 'active';
CREATE INDEX idx_agouza_reserv_order ON public.agouza_stock_reservations(order_id);
CREATE INDEX idx_agouza_reserv_status ON public.agouza_stock_reservations(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agouza_stock_reservations TO authenticated;
GRANT ALL ON public.agouza_stock_reservations TO service_role;

ALTER TABLE public.agouza_stock_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agouza_reserv_select" ON public.agouza_stock_reservations
  FOR SELECT TO authenticated USING (public.can_manage_agouza(auth.uid()));
CREATE POLICY "agouza_reserv_insert" ON public.agouza_stock_reservations
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_agouza(auth.uid()));
CREATE POLICY "agouza_reserv_update" ON public.agouza_stock_reservations
  FOR UPDATE TO authenticated
  USING (public.can_manage_agouza(auth.uid()))
  WITH CHECK (public.can_manage_agouza(auth.uid()));
CREATE POLICY "agouza_reserv_delete" ON public.agouza_stock_reservations
  FOR DELETE TO authenticated USING (public.can_approve_agouza(auth.uid()));

-- ============================================================
-- updated_at triggers (reuse generic helper if exists)
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_agouza_treas_updated BEFORE UPDATE ON public.agouza_warehouse_treasury_txns
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_agouza_recon_updated BEFORE UPDATE ON public.agouza_warehouse_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_agouza_closure_updated BEFORE UPDATE ON public.agouza_daily_closures
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_agouza_reserv_updated BEFORE UPDATE ON public.agouza_stock_reservations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
