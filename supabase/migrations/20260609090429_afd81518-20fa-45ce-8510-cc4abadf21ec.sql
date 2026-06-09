
-- ========================================
-- 1) إضافة الأدوار الجديدة
-- ========================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'main_treasury_accountant';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'main_treasury_approver';

COMMIT;

-- ========================================
-- 2) جدول الحسابات
-- ========================================
CREATE TABLE IF NOT EXISTS public.main_treasury_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('cash','bank','wallet')),
  bank_name TEXT,
  account_number TEXT,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.main_treasury_accounts TO authenticated;
GRANT ALL ON public.main_treasury_accounts TO service_role;
ALTER TABLE public.main_treasury_accounts ENABLE ROW LEVEL SECURITY;

-- ========================================
-- 3) بنود المصروفات
-- ========================================
CREATE TABLE IF NOT EXISTS public.main_treasury_expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.main_treasury_expense_categories TO authenticated;
GRANT ALL ON public.main_treasury_expense_categories TO service_role;
ALTER TABLE public.main_treasury_expense_categories ENABLE ROW LEVEL SECURITY;

INSERT INTO public.main_treasury_expense_categories(code,label,sort_order) VALUES
  ('rent','إيجار',10),
  ('salaries','رواتب وأجور',20),
  ('major_maintenance','صيانة كبرى',30),
  ('assets','شراء أصول',40),
  ('utilities','مرافق (كهرباء/مياه/غاز)',50),
  ('transport','نقل وشحن',60),
  ('taxes','ضرائب ورسوم',70),
  ('legal','أتعاب قانونية ومحاسبية',80),
  ('insurance','تأمينات',90),
  ('marketing','تسويق وإعلانات',100),
  ('custody_topup','تمويل خزنة العهدة',110),
  ('other','مصروفات أخرى',999)
ON CONFLICT (code) DO NOTHING;

-- ========================================
-- 4) قواعد الاعتماد
-- ========================================
CREATE TABLE IF NOT EXISTS public.main_treasury_approval_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_amount NUMERIC(14,2) NOT NULL,
  max_amount NUMERIC(14,2),
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  requires_dual_approval BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.main_treasury_approval_rules TO authenticated;
GRANT ALL ON public.main_treasury_approval_rules TO service_role;
ALTER TABLE public.main_treasury_approval_rules ENABLE ROW LEVEL SECURITY;

INSERT INTO public.main_treasury_approval_rules(min_amount,max_amount,requires_approval,requires_dual_approval) VALUES
  (0, 5000, false, false),
  (5000.01, 50000, true, false),
  (50000.01, NULL, true, true);

-- ========================================
-- 5) جدول الحركات الرئيسي
-- ========================================
CREATE SEQUENCE IF NOT EXISTS public.main_treasury_txn_seq;

CREATE TABLE IF NOT EXISTS public.main_treasury_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no TEXT UNIQUE,
  account_id UUID NOT NULL REFERENCES public.main_treasury_accounts(id) ON DELETE RESTRICT,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('deposit','withdrawal','expense','transfer_to_custody','adjustment')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category_id UUID REFERENCES public.main_treasury_expense_categories(id),
  counterparty TEXT,
  description TEXT NOT NULL,
  attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('draft','pending_approval','approved','posted','rejected','reversed')),
  requires_dual_approval BOOLEAN NOT NULL DEFAULT false,
  approver_1_id UUID,
  approver_1_at TIMESTAMPTZ,
  approver_2_id UUID,
  approver_2_at TIMESTAMPTZ,
  rejection_reason TEXT,
  posted_at TIMESTAMPTZ,
  reversed_by_txn_id UUID REFERENCES public.main_treasury_transactions(id),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mt_txn_account ON public.main_treasury_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_mt_txn_status ON public.main_treasury_transactions(status);
CREATE INDEX IF NOT EXISTS idx_mt_txn_date ON public.main_treasury_transactions(txn_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.main_treasury_transactions TO authenticated;
GRANT ALL ON public.main_treasury_transactions TO service_role;
ALTER TABLE public.main_treasury_transactions ENABLE ROW LEVEL SECURITY;

-- ========================================
-- 6) تحويلات للعهدة
-- ========================================
CREATE TABLE IF NOT EXISTS public.main_treasury_to_custody_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  main_txn_id UUID NOT NULL REFERENCES public.main_treasury_transactions(id) ON DELETE RESTRICT,
  custody_keeper_id UUID NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','received','rejected')),
  received_at TIMESTAMPTZ,
  received_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.main_treasury_to_custody_transfers TO authenticated;
GRANT ALL ON public.main_treasury_to_custody_transfers TO service_role;
ALTER TABLE public.main_treasury_to_custody_transfers ENABLE ROW LEVEL SECURITY;

-- ========================================
-- 7) سجل التدقيق
-- ========================================
CREATE TABLE IF NOT EXISTS public.main_treasury_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id UUID REFERENCES public.main_treasury_transactions(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  performed_by UUID NOT NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB
);
GRANT SELECT, INSERT ON public.main_treasury_audit_log TO authenticated;
GRANT ALL ON public.main_treasury_audit_log TO service_role;
ALTER TABLE public.main_treasury_audit_log ENABLE ROW LEVEL SECURITY;

-- ========================================
-- 8) Helper: roles check (re-use existing has_role)
-- ========================================
CREATE OR REPLACE FUNCTION public.has_main_treasury_access(_user_id uuid)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('main_treasury_accountant','main_treasury_approver','general_manager','executive_manager','financial_manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_main_treasury_approver(_user_id uuid)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('main_treasury_approver','general_manager','executive_manager','financial_manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_main_treasury_accountant(_user_id uuid)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'main_treasury_accountant'
  );
$$;

-- ========================================
-- 9) RLS Policies
-- ========================================
CREATE POLICY "mt_accounts_select" ON public.main_treasury_accounts
  FOR SELECT TO authenticated USING (public.has_main_treasury_access(auth.uid()));
CREATE POLICY "mt_accounts_write" ON public.main_treasury_accounts
  FOR ALL TO authenticated
  USING (public.is_main_treasury_approver(auth.uid()) OR public.is_main_treasury_accountant(auth.uid()))
  WITH CHECK (public.is_main_treasury_approver(auth.uid()) OR public.is_main_treasury_accountant(auth.uid()));

CREATE POLICY "mt_cat_select" ON public.main_treasury_expense_categories
  FOR SELECT TO authenticated USING (public.has_main_treasury_access(auth.uid()));
CREATE POLICY "mt_cat_write" ON public.main_treasury_expense_categories
  FOR ALL TO authenticated
  USING (public.is_main_treasury_approver(auth.uid()) OR public.is_main_treasury_accountant(auth.uid()))
  WITH CHECK (public.is_main_treasury_approver(auth.uid()) OR public.is_main_treasury_accountant(auth.uid()));

CREATE POLICY "mt_rules_select" ON public.main_treasury_approval_rules
  FOR SELECT TO authenticated USING (public.has_main_treasury_access(auth.uid()));
CREATE POLICY "mt_rules_write" ON public.main_treasury_approval_rules
  FOR ALL TO authenticated
  USING (public.is_main_treasury_approver(auth.uid()))
  WITH CHECK (public.is_main_treasury_approver(auth.uid()));

CREATE POLICY "mt_txn_select" ON public.main_treasury_transactions
  FOR SELECT TO authenticated USING (public.has_main_treasury_access(auth.uid()));
CREATE POLICY "mt_txn_insert" ON public.main_treasury_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_main_treasury_accountant(auth.uid()) OR public.is_main_treasury_approver(auth.uid()));
CREATE POLICY "mt_txn_update" ON public.main_treasury_transactions
  FOR UPDATE TO authenticated
  USING (public.is_main_treasury_accountant(auth.uid()) OR public.is_main_treasury_approver(auth.uid()));
CREATE POLICY "mt_txn_delete" ON public.main_treasury_transactions
  FOR DELETE TO authenticated
  USING (public.is_main_treasury_approver(auth.uid()) AND status = 'draft');

CREATE POLICY "mt_xfer_select" ON public.main_treasury_to_custody_transfers
  FOR SELECT TO authenticated USING (
    public.has_main_treasury_access(auth.uid())
    OR public.has_role(auth.uid(), 'slaughterhouse_custody_keeper')
  );
CREATE POLICY "mt_xfer_write" ON public.main_treasury_to_custody_transfers
  FOR ALL TO authenticated
  USING (
    public.is_main_treasury_accountant(auth.uid())
    OR public.is_main_treasury_approver(auth.uid())
    OR public.has_role(auth.uid(), 'slaughterhouse_custody_keeper')
  )
  WITH CHECK (
    public.is_main_treasury_accountant(auth.uid())
    OR public.is_main_treasury_approver(auth.uid())
    OR public.has_role(auth.uid(), 'slaughterhouse_custody_keeper')
  );

CREATE POLICY "mt_audit_select" ON public.main_treasury_audit_log
  FOR SELECT TO authenticated USING (public.has_main_treasury_access(auth.uid()));
CREATE POLICY "mt_audit_insert" ON public.main_treasury_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- ========================================
-- 10) Triggers: reference_no, dual-approval flag, immutability, audit
-- ========================================
CREATE OR REPLACE FUNCTION public.mt_txn_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM COALESCE(NEW.txn_date, CURRENT_DATE));
  v_seq BIGINT;
  v_rule RECORD;
BEGIN
  IF NEW.reference_no IS NULL THEN
    v_seq := nextval('public.main_treasury_txn_seq');
    NEW.reference_no := 'MT-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  END IF;

  SELECT * INTO v_rule FROM public.main_treasury_approval_rules
    WHERE is_active
      AND NEW.amount >= min_amount
      AND (max_amount IS NULL OR NEW.amount <= max_amount)
    ORDER BY min_amount DESC LIMIT 1;

  IF v_rule.requires_dual_approval THEN
    NEW.requires_dual_approval := true;
  END IF;

  IF v_rule.requires_approval IS NOT NULL AND NOT v_rule.requires_approval THEN
    NEW.status := COALESCE(NEW.status, 'posted');
    IF NEW.status = 'pending_approval' THEN NEW.status := 'posted'; END IF;
    IF NEW.status = 'posted' THEN NEW.posted_at := now(); END IF;
  ELSE
    NEW.status := COALESCE(NULLIF(NEW.status,''), 'pending_approval');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mt_txn_before_insert ON public.main_treasury_transactions;
CREATE TRIGGER trg_mt_txn_before_insert
  BEFORE INSERT ON public.main_treasury_transactions
  FOR EACH ROW EXECUTE FUNCTION public.mt_txn_before_insert();

-- منع تعديل المعاملات المعتمدة/المرحّلة
CREATE OR REPLACE FUNCTION public.mt_txn_before_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IN ('posted','approved','reversed') THEN
    -- نسمح فقط بتغيير reversed_by_txn_id أو الحالة من approved إلى posted
    IF NEW.amount <> OLD.amount
       OR NEW.account_id <> OLD.account_id
       OR NEW.txn_type <> OLD.txn_type
       OR NEW.txn_date <> OLD.txn_date
       OR COALESCE(NEW.category_id::text,'') <> COALESCE(OLD.category_id::text,'')
       OR COALESCE(NEW.description,'') <> COALESCE(OLD.description,'') THEN
      RAISE EXCEPTION 'لا يمكن تعديل بيانات معاملة % بعد اعتمادها/ترحيلها', OLD.reference_no;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mt_txn_before_update ON public.main_treasury_transactions;
CREATE TRIGGER trg_mt_txn_before_update
  BEFORE UPDATE ON public.main_treasury_transactions
  FOR EACH ROW EXECUTE FUNCTION public.mt_txn_before_update();

-- سجل تدقيق تلقائي
CREATE OR REPLACE FUNCTION public.mt_txn_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.main_treasury_audit_log(txn_id, action, new_status, performed_by)
      VALUES (NEW.id, 'created', NEW.status, COALESCE(auth.uid(), NEW.created_by));
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.main_treasury_audit_log(txn_id, action, old_status, new_status, performed_by, details)
      VALUES (NEW.id, 'status_change', OLD.status, NEW.status, COALESCE(auth.uid(), NEW.created_by),
              jsonb_build_object('rejection_reason', NEW.rejection_reason));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mt_txn_audit ON public.main_treasury_transactions;
CREATE TRIGGER trg_mt_txn_audit
  AFTER INSERT OR UPDATE ON public.main_treasury_transactions
  FOR EACH ROW EXECUTE FUNCTION public.mt_txn_audit();

-- ========================================
-- 11) RPCs: approve / reject / post
-- ========================================
CREATE OR REPLACE FUNCTION public.mt_approve_txn(p_txn_id UUID)
RETURNS public.main_treasury_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.main_treasury_transactions;
BEGIN
  IF NOT public.is_main_treasury_approver(auth.uid()) THEN
    RAISE EXCEPTION 'صلاحية اعتماد الخزنة الرئيسية فقط';
  END IF;

  SELECT * INTO t FROM public.main_treasury_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المعاملة غير موجودة'; END IF;
  IF t.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'المعاملة ليست في حالة انتظار اعتماد (الحالة: %)', t.status;
  END IF;

  IF t.requires_dual_approval THEN
    IF t.approver_1_id IS NULL THEN
      UPDATE public.main_treasury_transactions
        SET approver_1_id = auth.uid(), approver_1_at = now()
        WHERE id = p_txn_id RETURNING * INTO t;
      RETURN t;
    ELSIF t.approver_1_id = auth.uid() THEN
      RAISE EXCEPTION 'يلزم اعتماد ثاني من معتمد مختلف';
    ELSE
      UPDATE public.main_treasury_transactions
        SET approver_2_id = auth.uid(), approver_2_at = now(),
            status = 'posted', posted_at = now()
        WHERE id = p_txn_id RETURNING * INTO t;
      RETURN t;
    END IF;
  ELSE
    UPDATE public.main_treasury_transactions
      SET approver_1_id = auth.uid(), approver_1_at = now(),
          status = 'posted', posted_at = now()
      WHERE id = p_txn_id RETURNING * INTO t;
    RETURN t;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mt_reject_txn(p_txn_id UUID, p_reason TEXT)
RETURNS public.main_treasury_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.main_treasury_transactions;
BEGIN
  IF NOT public.is_main_treasury_approver(auth.uid()) THEN
    RAISE EXCEPTION 'صلاحية اعتماد الخزنة الرئيسية فقط';
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'سبب الرفض مطلوب';
  END IF;
  UPDATE public.main_treasury_transactions
    SET status='rejected', rejection_reason=p_reason
    WHERE id=p_txn_id AND status IN ('pending_approval','draft')
    RETURNING * INTO t;
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يمكن رفض هذه المعاملة'; END IF;
  RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION public.mt_receive_custody_transfer(p_transfer_id UUID)
RETURNS public.main_treasury_to_custody_transfers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x public.main_treasury_to_custody_transfers;
BEGIN
  IF NOT public.has_role(auth.uid(), 'slaughterhouse_custody_keeper') THEN
    RAISE EXCEPTION 'أمين خزنة العهدة فقط هو من يستلم التحويل';
  END IF;
  UPDATE public.main_treasury_to_custody_transfers
    SET status='received', received_at=now(), received_by=auth.uid()
    WHERE id=p_transfer_id AND status='sent'
    RETURNING * INTO x;
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يمكن استلام هذا التحويل'; END IF;
  RETURN x;
END;
$$;

-- ========================================
-- 12) View: الرصيد اللحظي
-- ========================================
CREATE OR REPLACE VIEW public.v_main_treasury_balance AS
SELECT
  a.id AS account_id,
  a.name,
  a.account_type,
  a.bank_name,
  a.opening_balance,
  COALESCE(SUM(CASE
    WHEN t.status='posted' AND t.txn_type IN ('deposit') THEN t.amount
    WHEN t.status='posted' AND t.txn_type IN ('withdrawal','expense','transfer_to_custody') THEN -t.amount
    WHEN t.status='posted' AND t.txn_type='adjustment' THEN t.amount
    ELSE 0 END), 0) AS net_movements,
  a.opening_balance + COALESCE(SUM(CASE
    WHEN t.status='posted' AND t.txn_type IN ('deposit') THEN t.amount
    WHEN t.status='posted' AND t.txn_type IN ('withdrawal','expense','transfer_to_custody') THEN -t.amount
    WHEN t.status='posted' AND t.txn_type='adjustment' THEN t.amount
    ELSE 0 END), 0) AS current_balance,
  COALESCE(SUM(CASE WHEN t.status='pending_approval' THEN t.amount ELSE 0 END),0) AS pending_amount,
  COUNT(CASE WHEN t.status='pending_approval' THEN 1 END) AS pending_count
FROM public.main_treasury_accounts a
LEFT JOIN public.main_treasury_transactions t ON t.account_id = a.id
WHERE a.is_active
GROUP BY a.id, a.name, a.account_type, a.bank_name, a.opening_balance;

GRANT SELECT ON public.v_main_treasury_balance TO authenticated;

-- ========================================
-- 13) Seed: حساب نقدي افتراضي
-- ========================================
INSERT INTO public.main_treasury_accounts(name,account_type,opening_balance,notes)
SELECT 'الخزنة الرئيسية — نقدي', 'cash', 0, 'الحساب الافتراضي للخزنة الرئيسية للشركة'
WHERE NOT EXISTS (SELECT 1 FROM public.main_treasury_accounts);
