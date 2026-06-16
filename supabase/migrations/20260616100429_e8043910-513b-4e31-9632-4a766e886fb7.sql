
-- =====================================================
-- Feed production invoice manufacturing expenses
-- =====================================================

CREATE TABLE IF NOT EXISTS public.feed_production_invoice_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.feed_production_invoices(id) ON DELETE CASCADE,
  expense_type text NOT NULL,
  description text,
  amount numeric NOT NULL CHECK (amount > 0),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text,
  paid_from_treasury boolean NOT NULL DEFAULT false,
  treasury_kind text,
  treasury_txn_id uuid REFERENCES public.feed_factory_treasury_txns(id) ON DELETE SET NULL,
  receipt_url text,
  notes text,
  reference_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reversed')),
  reverse_reason text,
  reversed_at timestamptz,
  reversed_by uuid,
  reverse_treasury_txn_id uuid REFERENCES public.feed_factory_treasury_txns(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_inv_exp_invoice ON public.feed_production_invoice_expenses(invoice_id);
CREATE INDEX IF NOT EXISTS idx_feed_inv_exp_status ON public.feed_production_invoice_expenses(status);

GRANT SELECT, INSERT, UPDATE ON public.feed_production_invoice_expenses TO authenticated;
GRANT ALL ON public.feed_production_invoice_expenses TO service_role;

ALTER TABLE public.feed_production_invoice_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feed_inv_exp_read"
  ON public.feed_production_invoice_expenses FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "feed_inv_exp_write_managers"
  ON public.feed_production_invoice_expenses FOR INSERT
  TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'feed_factory_manager'::app_role,'warehouse_supervisor'::app_role,
    'financial_manager'::app_role,'accountant'::app_role,'cost_accountant'::app_role
  ]));

CREATE POLICY "feed_inv_exp_update_admins"
  ON public.feed_production_invoice_expenses FOR UPDATE
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'financial_manager'::app_role,'feed_factory_manager'::app_role
  ]));

-- =====================================================
-- Totals recalculation
-- =====================================================
CREATE OR REPLACE FUNCTION public.recalc_feed_invoice_totals(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items numeric;
  v_exp numeric;
  v_labor numeric;
  v_qty numeric;
  v_total numeric;
BEGIN
  SELECT COALESCE(SUM(line_cost),0) INTO v_items
    FROM feed_production_invoice_items WHERE invoice_id = _invoice_id;

  SELECT COALESCE(SUM(amount),0) INTO v_exp
    FROM feed_production_invoice_expenses
    WHERE invoice_id = _invoice_id AND status='active';

  SELECT COALESCE(labor_cost,0), COALESCE(qty_produced,0)
    INTO v_labor, v_qty
    FROM feed_production_invoices WHERE id = _invoice_id;

  v_total := v_items + v_exp + COALESCE(v_labor,0);

  UPDATE feed_production_invoices
     SET total_cost = v_total,
         unit_cost = CASE WHEN v_qty>0 THEN v_total/v_qty ELSE 0 END,
         updated_at = now()
   WHERE id = _invoice_id;
END $$;

CREATE OR REPLACE FUNCTION public.trg_recalc_feed_invoice_after_exp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM recalc_feed_invoice_totals(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_feed_inv_exp_recalc ON public.feed_production_invoice_expenses;
CREATE TRIGGER trg_feed_inv_exp_recalc
AFTER INSERT OR UPDATE OR DELETE ON public.feed_production_invoice_expenses
FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_feed_invoice_after_exp();

CREATE OR REPLACE FUNCTION public.trg_feed_inv_exp_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_feed_inv_exp_updated_at ON public.feed_production_invoice_expenses;
CREATE TRIGGER trg_feed_inv_exp_updated_at BEFORE UPDATE ON public.feed_production_invoice_expenses
FOR EACH ROW EXECUTE FUNCTION public.trg_feed_inv_exp_updated();

-- =====================================================
-- Add expense RPC (handles optional treasury withdrawal)
-- =====================================================
CREATE OR REPLACE FUNCTION public.add_feed_invoice_expense(
  p_invoice_id uuid,
  p_expense_type text,
  p_description text,
  p_amount numeric,
  p_expense_date date DEFAULT CURRENT_DATE,
  p_payment_method text DEFAULT NULL,
  p_paid_from_treasury boolean DEFAULT false,
  p_treasury_kind text DEFAULT 'general_expense',
  p_receipt_url text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_reference_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_ref text;
  v_txn_id uuid;
  v_exp_id uuid;
  v_kind text;
  v_existing uuid;
BEGIN
  IF NOT has_any_role(v_user, ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'feed_factory_manager'::app_role,'warehouse_supervisor'::app_role,
    'financial_manager'::app_role,'accountant'::app_role,'cost_accountant'::app_role
  ]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  v_ref := COALESCE(p_reference_id,
    'feed_mfg_exp_'||p_invoice_id::text||'_'||p_expense_type||'_'||extract(epoch from now())::bigint::text);

  -- duplicate guard
  SELECT id INTO v_existing FROM feed_production_invoice_expenses WHERE reference_id = v_ref;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_kind := CASE
    WHEN p_treasury_kind IN ('general_expense','tobacco_expense','transport_expense','custody_shoala','custody_gamal','manual_out','other')
      THEN p_treasury_kind
    ELSE 'general_expense' END;

  IF p_paid_from_treasury THEN
    INSERT INTO feed_factory_treasury_txns(txn_date, direction, kind, amount, ref_table, ref_id, note, created_by)
    VALUES (p_expense_date, 'out', v_kind, p_amount, 'feed_production_invoice_expenses', NULL,
            COALESCE(p_description, p_expense_type)||' (فاتورة تصنيع)', v_user)
    RETURNING id INTO v_txn_id;
  END IF;

  INSERT INTO feed_production_invoice_expenses(
    invoice_id, expense_type, description, amount, expense_date,
    payment_method, paid_from_treasury, treasury_kind, treasury_txn_id,
    receipt_url, notes, reference_id, created_by
  ) VALUES (
    p_invoice_id, p_expense_type, p_description, p_amount, p_expense_date,
    p_payment_method, p_paid_from_treasury, v_kind, v_txn_id,
    p_receipt_url, p_notes, v_ref, v_user
  ) RETURNING id INTO v_exp_id;

  IF v_txn_id IS NOT NULL THEN
    UPDATE feed_factory_treasury_txns SET ref_id = v_exp_id WHERE id = v_txn_id;
  END IF;

  INSERT INTO feed_audit_log(table_name, row_id, action, new_value, performed_by, notes)
  VALUES ('feed_production_invoice_expenses', v_exp_id, 'add_expense',
          jsonb_build_object('invoice_id',p_invoice_id,'amount',p_amount,'type',p_expense_type,'paid_from_treasury',p_paid_from_treasury),
          v_user, p_description);

  RETURN v_exp_id;
END $$;

GRANT EXECUTE ON FUNCTION public.add_feed_invoice_expense(uuid,text,text,numeric,date,text,boolean,text,text,text,text) TO authenticated;

-- =====================================================
-- Reverse expense (admins only)
-- =====================================================
CREATE OR REPLACE FUNCTION public.reverse_feed_invoice_expense(
  p_expense_id uuid, p_reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row feed_production_invoice_expenses%ROWTYPE;
  v_rev_txn uuid;
BEGIN
  IF NOT has_any_role(v_user, ARRAY['general_manager'::app_role,'executive_manager'::app_role]) THEN
    RAISE EXCEPTION 'not_authorized_reverse';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO v_row FROM feed_production_invoice_expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status = 'reversed' THEN RAISE EXCEPTION 'already_reversed'; END IF;

  IF v_row.paid_from_treasury AND v_row.treasury_txn_id IS NOT NULL THEN
    INSERT INTO feed_factory_treasury_txns(txn_date, direction, kind, amount, ref_table, ref_id, note, created_by)
    VALUES (CURRENT_DATE, 'in', COALESCE(v_row.treasury_kind,'general_expense'), v_row.amount,
            'feed_production_invoice_expenses', v_row.id,
            'عكس مصروف تصنيع: '||COALESCE(p_reason,''), v_user)
    RETURNING id INTO v_rev_txn;
  END IF;

  UPDATE feed_production_invoice_expenses
     SET status='reversed', reverse_reason=p_reason, reversed_at=now(),
         reversed_by=v_user, reverse_treasury_txn_id=v_rev_txn
   WHERE id = p_expense_id;

  INSERT INTO feed_audit_log(table_name, row_id, action, old_value, new_value, performed_by, notes)
  VALUES ('feed_production_invoice_expenses', p_expense_id, 'reverse_expense',
          to_jsonb(v_row), jsonb_build_object('reason',p_reason,'reverse_txn_id',v_rev_txn),
          v_user, p_reason);
END $$;

GRANT EXECUTE ON FUNCTION public.reverse_feed_invoice_expense(uuid,text) TO authenticated;
