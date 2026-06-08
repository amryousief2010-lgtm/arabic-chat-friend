
-- ===== Table: feed_internal_payments =====
CREATE TABLE IF NOT EXISTS public.feed_internal_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_no TEXT UNIQUE NOT NULL DEFAULT ('FIP-' || to_char(now(), 'YYMMDDHH24MISSMS')),
  department_type TEXT NOT NULL CHECK (department_type IN ('brooding','slaughterhouse')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','vodafone_cash','instapay','bank_transfer','internal_settlement')),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_no TEXT,
  notes TEXT,
  receipt_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  created_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  treasury_txn_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fip_dept ON public.feed_internal_payments(department_type);
CREATE INDEX IF NOT EXISTS idx_fip_status ON public.feed_internal_payments(status);
CREATE INDEX IF NOT EXISTS idx_fip_date ON public.feed_internal_payments(payment_date DESC);

GRANT SELECT, INSERT, UPDATE ON public.feed_internal_payments TO authenticated;
GRANT ALL ON public.feed_internal_payments TO service_role;

ALTER TABLE public.feed_internal_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fip_select_authorized" ON public.feed_internal_payments
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'feed_factory_manager') OR has_role(auth.uid(),'accountant')
  OR has_role(auth.uid(),'financial_manager')
  OR (department_type='brooding' AND (has_role(auth.uid(),'brooding_manager') OR has_role(auth.uid(),'production_manager')))
  OR (department_type='slaughterhouse' AND (has_role(auth.uid(),'slaughterhouse_manager') OR has_role(auth.uid(),'warehouse_supervisor')))
);

CREATE POLICY "fip_insert_authorized" ON public.feed_internal_payments
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'feed_factory_manager') OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'financial_manager')
  OR (department_type='brooding' AND (has_role(auth.uid(),'brooding_manager') OR has_role(auth.uid(),'production_manager')))
  OR (department_type='slaughterhouse' AND (has_role(auth.uid(),'slaughterhouse_manager') OR has_role(auth.uid(),'warehouse_supervisor')))
);

CREATE POLICY "fip_update_managers" ON public.feed_internal_payments
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'feed_factory_manager') OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'financial_manager')
);

-- ===== Audit table =====
CREATE TABLE IF NOT EXISTS public.feed_internal_payments_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL,
  action TEXT NOT NULL,
  department_type TEXT,
  amount NUMERIC(14,2),
  payment_method TEXT,
  old_status TEXT,
  new_status TEXT,
  reason TEXT,
  performed_by UUID,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.feed_internal_payments_audit TO authenticated;
GRANT ALL ON public.feed_internal_payments_audit TO service_role;
ALTER TABLE public.feed_internal_payments_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fipa_select_managers" ON public.feed_internal_payments_audit
FOR SELECT TO authenticated USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'feed_factory_manager') OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'financial_manager')
);
CREATE POLICY "fipa_insert_system" ON public.feed_internal_payments_audit
FOR INSERT TO authenticated WITH CHECK (true);

-- ===== updated_at trigger =====
CREATE OR REPLACE FUNCTION public.fip_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_fip_updated_at ON public.feed_internal_payments;
CREATE TRIGGER trg_fip_updated_at BEFORE UPDATE ON public.feed_internal_payments
FOR EACH ROW EXECUTE FUNCTION public.fip_set_updated_at();

-- ===== Approval trigger: push to factory treasury when approved & non-settlement =====
CREATE OR REPLACE FUNCTION public.fip_handle_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_txn_id UUID;
  v_kind TEXT;
  v_party TEXT;
BEGIN
  -- approval transition pending -> approved
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    IF NEW.payment_method <> 'internal_settlement' THEN
      -- prevent duplicate treasury entry
      IF NEW.treasury_txn_id IS NULL THEN
        v_kind := 'manual_in';
        v_party := CASE NEW.department_type
          WHEN 'brooding' THEN 'سداد حضانات التسمين'
          WHEN 'slaughterhouse' THEN 'سداد مخزن علف المجزر'
        END;

        INSERT INTO feed_factory_treasury_txns(
          txn_no, txn_date, direction, kind, amount, ref_table, ref_id, party, note, created_by
        ) VALUES (
          'FIP-' || NEW.payment_no, NEW.payment_date, 'in', v_kind, NEW.amount,
          'feed_internal_payments', NEW.id, v_party,
          'سداد داخلي معتمد — ' || COALESCE(NEW.notes,'') || ' (طريقة: ' || NEW.payment_method || ')',
          NEW.approved_by
        ) RETURNING id INTO v_txn_id;

        NEW.treasury_txn_id := v_txn_id;
      END IF;
    END IF;

    INSERT INTO feed_internal_payments_audit(payment_id, action, department_type, amount, payment_method, old_status, new_status, reason, performed_by)
    VALUES (NEW.id, 'approve', NEW.department_type, NEW.amount, NEW.payment_method, OLD.status, NEW.status, NULL, NEW.approved_by);

  -- rejection
  ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    INSERT INTO feed_internal_payments_audit(payment_id, action, department_type, amount, payment_method, old_status, new_status, reason, performed_by)
    VALUES (NEW.id, 'reject', NEW.department_type, NEW.amount, NEW.payment_method, OLD.status, NEW.status, NEW.rejected_reason, auth.uid());

  -- cancellation (reversal): if previously approved, reverse the treasury txn
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF OLD.status = 'approved' AND OLD.treasury_txn_id IS NOT NULL THEN
      INSERT INTO feed_factory_treasury_txns(
        txn_no, txn_date, direction, kind, amount, ref_table, ref_id, party, note, created_by
      ) VALUES (
        'REV-' || OLD.payment_no || '-' || to_char(now(),'HH24MISS'), CURRENT_DATE, 'out', 'manual_out', OLD.amount,
        'feed_internal_payments', OLD.id, 'عكس سداد داخلي',
        'حركة عكسية لإلغاء سداد رقم ' || OLD.payment_no, auth.uid()
      );
    END IF;
    INSERT INTO feed_internal_payments_audit(payment_id, action, department_type, amount, payment_method, old_status, new_status, reason, performed_by)
    VALUES (NEW.id, 'cancel', NEW.department_type, NEW.amount, NEW.payment_method, OLD.status, NEW.status, NEW.rejected_reason, auth.uid());
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_fip_status_change ON public.feed_internal_payments;
CREATE TRIGGER trg_fip_status_change
BEFORE UPDATE OF status ON public.feed_internal_payments
FOR EACH ROW EXECUTE FUNCTION public.fip_handle_status_change();

-- ===== Insert audit trigger =====
CREATE OR REPLACE FUNCTION public.fip_audit_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO feed_internal_payments_audit(payment_id, action, department_type, amount, payment_method, old_status, new_status, performed_by)
  VALUES (NEW.id, 'create', NEW.department_type, NEW.amount, NEW.payment_method, NULL, NEW.status, NEW.created_by);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_fip_audit_insert ON public.feed_internal_payments;
CREATE TRIGGER trg_fip_audit_insert AFTER INSERT ON public.feed_internal_payments
FOR EACH ROW EXECUTE FUNCTION public.fip_audit_insert();

-- ===== View: balances per department =====
CREATE OR REPLACE VIEW public.v_feed_internal_balances AS
WITH supplied AS (
  SELECT
    CASE fs.destination_type
      WHEN 'brooding_feed_store' THEN 'brooding'
      WHEN 'slaughterhouse_feed_store' THEN 'slaughterhouse'
    END AS department_type,
    SUM(fsi.quantity * COALESCE(fsi.unit_price, 0)) AS total_supplied_value,
    COUNT(DISTINCT fs.id) AS supply_invoices_count,
    MAX(fs.sale_date) AS last_supply_date
  FROM feed_sales fs
  JOIN feed_sale_items fsi ON fsi.sale_id = fs.id
  WHERE fs.destination_type IN ('brooding_feed_store','slaughterhouse_feed_store')
  GROUP BY 1
),
paid AS (
  SELECT department_type,
    SUM(amount) FILTER (WHERE status='approved') AS total_paid,
    MAX(payment_date) FILTER (WHERE status='approved') AS last_payment_date,
    COUNT(*) FILTER (WHERE status='pending') AS pending_payments_count
  FROM feed_internal_payments
  GROUP BY 1
)
SELECT
  d.department_type,
  CASE d.department_type
    WHEN 'brooding' THEN 'حضانات التسمين'
    WHEN 'slaughterhouse' THEN 'مخزن علف المجزر'
  END AS department_label,
  COALESCE(s.total_supplied_value, 0) AS total_supplied_value,
  COALESCE(p.total_paid, 0) AS total_paid,
  COALESCE(s.total_supplied_value, 0) - COALESCE(p.total_paid, 0) AS remaining_debt,
  s.last_supply_date,
  p.last_payment_date,
  COALESCE(s.supply_invoices_count, 0) AS supply_invoices_count,
  COALESCE(p.pending_payments_count, 0) AS pending_payments_count,
  CASE
    WHEN COALESCE(s.total_supplied_value, 0) - COALESCE(p.total_paid, 0) <= 0 THEN 'no_debt'
    WHEN COALESCE(p.total_paid, 0) = 0 THEN 'unpaid'
    ELSE 'partially_paid'
  END AS account_status
FROM (VALUES ('brooding'),('slaughterhouse')) d(department_type)
LEFT JOIN supplied s USING (department_type)
LEFT JOIN paid p USING (department_type);

GRANT SELECT ON public.v_feed_internal_balances TO authenticated;
