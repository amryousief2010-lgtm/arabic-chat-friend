
-- ========== ENUMS ==========
DO $$ BEGIN
  CREATE TYPE public.slaughter_custody_status AS ENUM ('pending_review','clarification_needed','approved','rejected','over_limit_pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.slaughter_custody_payment_method AS ENUM ('cash','vodafone_cash','instapay','bank_transfer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.slaughter_custody_category AS ENUM (
    'maintenance','utilities','supplies','cleaning','transport','daily_labor',
    'hospitality','urgent_purchase','government','veterinary','equipment_repair',
    'fridge_repair','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ========== HELPER ==========
CREATE OR REPLACE FUNCTION public.is_slaughter_custody_manager(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_uid,'general_manager'::app_role)
    OR public.has_role(_uid,'executive_manager'::app_role)
    OR public.has_role(_uid,'lab_treasury_approver'::app_role)
    OR public.has_role(_uid,'slaughterhouse_manager'::app_role);
$$;

-- ========== 1. OPENING BALANCES ==========
CREATE TABLE public.slaughter_custody_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of_date date NOT NULL,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  cash_amount numeric(14,2) NOT NULL DEFAULT 0,
  vodafone_cash_amount numeric(14,2) NOT NULL DEFAULT 0,
  instapay_amount numeric(14,2) NOT NULL DEFAULT 0,
  bank_transfer_amount numeric(14,2) NOT NULL DEFAULT 0,
  status public.slaughter_custody_status NOT NULL DEFAULT 'pending_review',
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.slaughter_custody_opening_balances TO authenticated;
GRANT ALL ON public.slaughter_custody_opening_balances TO service_role;
ALTER TABLE public.slaughter_custody_opening_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custody_open_select" ON public.slaughter_custody_opening_balances FOR SELECT TO authenticated
  USING (public.is_slaughter_custody_manager(auth.uid()) OR public.has_role(auth.uid(),'slaughterhouse_custody_keeper'::app_role));
CREATE POLICY "custody_open_mgr_ins" ON public.slaughter_custody_opening_balances FOR INSERT TO authenticated
  WITH CHECK (public.is_slaughter_custody_manager(auth.uid()));
CREATE POLICY "custody_open_mgr_upd" ON public.slaughter_custody_opening_balances FOR UPDATE TO authenticated
  USING (public.is_slaughter_custody_manager(auth.uid()));

-- ========== 2. WEEKLY LIMITS ==========
CREATE TABLE public.slaughter_custody_weekly_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date date NOT NULL UNIQUE,
  week_end_date date NOT NULL,
  limit_amount numeric(14,2) NOT NULL,
  notes text,
  set_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.slaughter_custody_weekly_limits TO authenticated;
GRANT ALL ON public.slaughter_custody_weekly_limits TO service_role;
ALTER TABLE public.slaughter_custody_weekly_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custody_lim_select" ON public.slaughter_custody_weekly_limits FOR SELECT TO authenticated
  USING (public.is_slaughter_custody_manager(auth.uid()) OR public.has_role(auth.uid(),'slaughterhouse_custody_keeper'::app_role));
CREATE POLICY "custody_lim_mgr_ins" ON public.slaughter_custody_weekly_limits FOR INSERT TO authenticated
  WITH CHECK (public.is_slaughter_custody_manager(auth.uid()));
CREATE POLICY "custody_lim_mgr_upd" ON public.slaughter_custody_weekly_limits FOR UPDATE TO authenticated
  USING (public.is_slaughter_custody_manager(auth.uid()));

-- ========== 3. EXPENSES ==========
CREATE TABLE public.slaughter_custody_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL DEFAULT current_date,
  category public.slaughter_custody_category NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method public.slaughter_custody_payment_method NOT NULL,
  beneficiary text,
  has_invoice boolean NOT NULL DEFAULT false,
  receipt_url text,
  notes text,
  status public.slaughter_custody_status NOT NULL DEFAULT 'pending_review',
  rejection_reason text,
  over_limit boolean NOT NULL DEFAULT false,
  week_start_date date,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_custody_exp_date ON public.slaughter_custody_expenses(expense_date);
CREATE INDEX idx_custody_exp_status ON public.slaughter_custody_expenses(status);
CREATE INDEX idx_custody_exp_week ON public.slaughter_custody_expenses(week_start_date);

GRANT SELECT, INSERT, UPDATE ON public.slaughter_custody_expenses TO authenticated;
GRANT ALL ON public.slaughter_custody_expenses TO service_role;
ALTER TABLE public.slaughter_custody_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custody_exp_select" ON public.slaughter_custody_expenses FOR SELECT TO authenticated
  USING (
    public.is_slaughter_custody_manager(auth.uid())
    OR (public.has_role(auth.uid(),'slaughterhouse_custody_keeper'::app_role) AND created_by = auth.uid())
  );

CREATE POLICY "custody_exp_insert" ON public.slaughter_custody_expenses FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (public.has_role(auth.uid(),'slaughterhouse_custody_keeper'::app_role) OR public.is_slaughter_custody_manager(auth.uid()))
  );

CREATE POLICY "custody_exp_mgr_update" ON public.slaughter_custody_expenses FOR UPDATE TO authenticated
  USING (public.is_slaughter_custody_manager(auth.uid()));

-- ========== 4. COMMENTS ==========
CREATE TABLE public.slaughter_custody_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.slaughter_custody_expenses(id) ON DELETE CASCADE,
  body text NOT NULL,
  attachment_url text,
  is_clarification_request boolean NOT NULL DEFAULT false,
  author_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_custody_comments_expense ON public.slaughter_custody_comments(expense_id);
GRANT SELECT, INSERT ON public.slaughter_custody_comments TO authenticated;
GRANT ALL ON public.slaughter_custody_comments TO service_role;
ALTER TABLE public.slaughter_custody_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custody_cmt_select" ON public.slaughter_custody_comments FOR SELECT TO authenticated
  USING (
    public.is_slaughter_custody_manager(auth.uid())
    OR EXISTS (SELECT 1 FROM public.slaughter_custody_expenses e
               WHERE e.id = expense_id AND e.created_by = auth.uid())
  );

CREATE POLICY "custody_cmt_insert" ON public.slaughter_custody_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND (
      public.is_slaughter_custody_manager(auth.uid())
      OR EXISTS (SELECT 1 FROM public.slaughter_custody_expenses e
                 WHERE e.id = expense_id AND e.created_by = auth.uid())
    )
  );

-- ========== 5. WEEK CLOSURES ==========
CREATE TABLE public.slaughter_custody_week_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid NOT NULL DEFAULT auth.uid(),
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_reason text,
  is_open boolean NOT NULL DEFAULT false,
  total_approved numeric(14,2),
  total_rejected numeric(14,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.slaughter_custody_week_closures TO authenticated;
GRANT ALL ON public.slaughter_custody_week_closures TO service_role;
ALTER TABLE public.slaughter_custody_week_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custody_close_select" ON public.slaughter_custody_week_closures FOR SELECT TO authenticated
  USING (public.is_slaughter_custody_manager(auth.uid()) OR public.has_role(auth.uid(),'slaughterhouse_custody_keeper'::app_role));
CREATE POLICY "custody_close_mgr_ins" ON public.slaughter_custody_week_closures FOR INSERT TO authenticated
  WITH CHECK (public.is_slaughter_custody_manager(auth.uid()));
CREATE POLICY "custody_close_mgr_upd" ON public.slaughter_custody_week_closures FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'general_manager'::app_role) OR public.has_role(auth.uid(),'executive_manager'::app_role));

-- ========== 6. AUDIT LOG ==========
CREATE TABLE public.slaughter_custody_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  actor_id uuid DEFAULT auth.uid(),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_custody_audit_entity ON public.slaughter_custody_audit_log(entity, entity_id);
CREATE INDEX idx_custody_audit_created ON public.slaughter_custody_audit_log(created_at DESC);
GRANT SELECT, INSERT ON public.slaughter_custody_audit_log TO authenticated;
GRANT ALL ON public.slaughter_custody_audit_log TO service_role;
ALTER TABLE public.slaughter_custody_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custody_audit_mgr_select" ON public.slaughter_custody_audit_log FOR SELECT TO authenticated
  USING (public.is_slaughter_custody_manager(auth.uid()));
CREATE POLICY "custody_audit_insert" ON public.slaughter_custody_audit_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- ========== TRIGGER: auto over_limit + week_start ==========
CREATE OR REPLACE FUNCTION public.slaughter_custody_set_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_week_start date;
  v_limit numeric;
  v_used numeric;
BEGIN
  v_week_start := date_trunc('week', NEW.expense_date)::date;
  NEW.week_start_date := v_week_start;

  SELECT limit_amount INTO v_limit FROM public.slaughter_custody_weekly_limits
    WHERE week_start_date = v_week_start LIMIT 1;

  IF v_limit IS NOT NULL THEN
    SELECT COALESCE(SUM(amount),0) INTO v_used
      FROM public.slaughter_custody_expenses
      WHERE week_start_date = v_week_start AND status IN ('approved','pending_review','clarification_needed');
    IF (v_used + NEW.amount) > v_limit THEN
      NEW.over_limit := true;
      NEW.status := 'over_limit_pending';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_custody_set_status BEFORE INSERT ON public.slaughter_custody_expenses
  FOR EACH ROW EXECUTE FUNCTION public.slaughter_custody_set_status();

-- ========== TRIGGER: audit ==========
CREATE OR REPLACE FUNCTION public.slaughter_custody_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.slaughter_custody_audit_log(action, entity, entity_id, actor_id, payload)
  VALUES (
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    auth.uid(),
    to_jsonb(COALESCE(NEW, OLD))
  );
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_custody_audit_exp AFTER INSERT OR UPDATE OR DELETE ON public.slaughter_custody_expenses
  FOR EACH ROW EXECUTE FUNCTION public.slaughter_custody_audit();
CREATE TRIGGER trg_custody_audit_lim AFTER INSERT OR UPDATE OR DELETE ON public.slaughter_custody_weekly_limits
  FOR EACH ROW EXECUTE FUNCTION public.slaughter_custody_audit();
CREATE TRIGGER trg_custody_audit_close AFTER INSERT OR UPDATE OR DELETE ON public.slaughter_custody_week_closures
  FOR EACH ROW EXECUTE FUNCTION public.slaughter_custody_audit();
CREATE TRIGGER trg_custody_audit_cmt AFTER INSERT ON public.slaughter_custody_comments
  FOR EACH ROW EXECUTE FUNCTION public.slaughter_custody_audit();
CREATE TRIGGER trg_custody_audit_open AFTER INSERT OR UPDATE ON public.slaughter_custody_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.slaughter_custody_audit();

CREATE TRIGGER trg_custody_exp_updated BEFORE UPDATE ON public.slaughter_custody_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_custody_lim_updated BEFORE UPDATE ON public.slaughter_custody_weekly_limits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_custody_open_updated BEFORE UPDATE ON public.slaughter_custody_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== VIEWS ==========
CREATE OR REPLACE VIEW public.v_slaughter_custody_balance AS
SELECT
  COALESCE((SELECT SUM(total_amount) FROM public.slaughter_custody_opening_balances WHERE status='approved'),0)
  - COALESCE((SELECT SUM(amount) FROM public.slaughter_custody_expenses WHERE status='approved'),0) AS current_balance,
  COALESCE((SELECT SUM(total_amount) FROM public.slaughter_custody_opening_balances WHERE status='approved'),0) AS total_opening,
  COALESCE((SELECT SUM(amount) FROM public.slaughter_custody_expenses WHERE status='approved'),0) AS total_approved_expenses;

CREATE OR REPLACE VIEW public.v_slaughter_custody_week_usage AS
WITH cur AS (
  SELECT date_trunc('week', current_date)::date AS ws,
         (date_trunc('week', current_date) + interval '6 days')::date AS we
)
SELECT
  cur.ws AS week_start_date,
  cur.we AS week_end_date,
  COALESCE((SELECT limit_amount FROM public.slaughter_custody_weekly_limits WHERE week_start_date = cur.ws),0) AS limit_amount,
  COALESCE((SELECT SUM(amount) FROM public.slaughter_custody_expenses WHERE week_start_date = cur.ws AND status='approved'),0) AS approved_total,
  COALESCE((SELECT SUM(amount) FROM public.slaughter_custody_expenses WHERE week_start_date = cur.ws AND status IN ('pending_review','clarification_needed','over_limit_pending')),0) AS pending_total
FROM cur;

GRANT SELECT ON public.v_slaughter_custody_balance TO authenticated;
GRANT SELECT ON public.v_slaughter_custody_week_usage TO authenticated;
