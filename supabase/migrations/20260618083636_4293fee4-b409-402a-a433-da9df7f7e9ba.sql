
-- Retry with text casts on status in the unmatched view's UNION

CREATE OR REPLACE FUNCTION public.hr_upsert_treasury_advance(
  p_source_table text, p_source_id uuid, p_employee_id uuid,
  p_amount numeric, p_date date, p_status text, p_reason text,
  p_rejection text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ref text; v_id uuid;
BEGIN
  IF p_employee_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN RETURN NULL; END IF;
  IF p_status NOT IN ('pending','approved','rejected') THEN p_status := 'pending'; END IF;
  v_ref := 'treasury_advance_' || p_source_table || '_' || p_source_id::text || '_' || p_employee_id::text;
  INSERT INTO hr_deductions(
    employee_id, deduction_date, month, year,
    deduction_type, amount, reason, status, reference_id, rejection_reason
  ) VALUES (
    p_employee_id, p_date,
    EXTRACT(MONTH FROM p_date)::smallint, EXTRACT(YEAR FROM p_date)::smallint,
    'advance_repayment', p_amount,
    COALESCE(p_reason,'سلفة موظف من الخزنة'),
    p_status, v_ref, p_rejection
  )
  ON CONFLICT (reference_id) DO UPDATE SET
    amount=EXCLUDED.amount, deduction_date=EXCLUDED.deduction_date,
    month=EXCLUDED.month, year=EXCLUDED.year, status=EXCLUDED.status,
    reason=COALESCE(EXCLUDED.reason, hr_deductions.reason),
    rejection_reason=EXCLUDED.rejection_reason, updated_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.hr_map_source_status(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IN ('approved','posted','completed','settled','active','open') THEN 'approved'
    WHEN p IN ('rejected','cancelled','canceled','reversed','void') THEN 'rejected'
    ELSE 'pending' END
$$;

UPDATE hr_deductions d SET reference_id =
  'treasury_advance_lab_treasury_movements_' ||
   split_part(replace(reference_id,'lab_advance_',''),'_',1) ||
  '_' || d.employee_id::text
WHERE reference_id LIKE 'lab_advance_%';

-- Triggers
CREATE OR REPLACE FUNCTION public.trg_lab_treasury_link_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NEW.movement_type::text <> 'expense' THEN RETURN NEW; END IF;
  IF NOT (public.hr_text_is_advance(NEW.description) OR public.hr_text_is_advance(NEW.notes)) THEN RETURN NEW; END IF;
  v_emp := public.hr_match_employee_by_name(NEW.beneficiary);
  IF v_emp IS NULL THEN RETURN NEW; END IF;
  PERFORM public.hr_upsert_treasury_advance(
    'lab_treasury_movements', NEW.id, v_emp, NEW.amount, NEW.movement_date,
    public.hr_map_source_status(NEW.status::text),
    COALESCE(NEW.description, NEW.notes,'سلفة من خزنة المعمل'),
    NEW.rejection_reason);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lab_treasury_link_advance ON public.lab_treasury_movements;
CREATE TRIGGER trg_lab_treasury_link_advance
AFTER INSERT OR UPDATE OF status, beneficiary, amount, description, notes, rejection_reason
ON public.lab_treasury_movements FOR EACH ROW EXECUTE FUNCTION public.trg_lab_treasury_link_advance();

CREATE OR REPLACE FUNCTION public.trg_lab_advances_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NEW.employee_user_id IS NOT NULL THEN
    SELECT id INTO v_emp FROM hr_employees WHERE user_id = NEW.employee_user_id LIMIT 1;
  END IF;
  IF v_emp IS NULL THEN v_emp := public.hr_match_employee_by_name(NEW.recipient_name); END IF;
  IF v_emp IS NULL THEN RETURN NEW; END IF;
  PERFORM public.hr_upsert_treasury_advance(
    'lab_treasury_advances', NEW.id, v_emp, NEW.amount, NEW.issued_at::date,
    public.hr_map_source_status(NEW.status::text),
    COALESCE(NEW.purpose,'سلفة موظف من خزنة المعمل'),
    NEW.cancellation_reason);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lab_advances_link ON public.lab_treasury_advances;
CREATE TRIGGER trg_lab_advances_link
AFTER INSERT OR UPDATE OF status, amount, employee_user_id, recipient_name, cancellation_reason
ON public.lab_treasury_advances FOR EACH ROW EXECUTE FUNCTION public.trg_lab_advances_link();

CREATE OR REPLACE FUNCTION public.trg_slaughter_custody_link_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NOT (public.hr_text_is_advance(NEW.description) OR public.hr_text_is_advance(NEW.notes)
          OR public.hr_text_is_advance(NEW.category::text)) THEN RETURN NEW; END IF;
  v_emp := public.hr_match_employee_by_name(NEW.beneficiary);
  IF v_emp IS NULL THEN RETURN NEW; END IF;
  PERFORM public.hr_upsert_treasury_advance(
    'slaughter_custody_expenses', NEW.id, v_emp, NEW.amount, NEW.expense_date,
    public.hr_map_source_status(NEW.status::text),
    COALESCE(NEW.description, NEW.notes,'سلفة من عهدة المجزر'),
    NEW.rejection_reason);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_slaughter_custody_link_advance ON public.slaughter_custody_expenses;
CREATE TRIGGER trg_slaughter_custody_link_advance
AFTER INSERT OR UPDATE OF status, beneficiary, amount, description, notes, rejection_reason
ON public.slaughter_custody_expenses FOR EACH ROW EXECUTE FUNCTION public.trg_slaughter_custody_link_advance();

CREATE OR REPLACE FUNCTION public.trg_feed_factory_link_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NEW.direction <> 'out' THEN RETURN NEW; END IF;
  IF NOT (public.hr_text_is_advance(NEW.note) OR public.hr_text_is_advance(NEW.kind)) THEN RETURN NEW; END IF;
  v_emp := public.hr_match_employee_by_name(NEW.party);
  IF v_emp IS NULL THEN RETURN NEW; END IF;
  PERFORM public.hr_upsert_treasury_advance(
    'feed_factory_treasury_txns', NEW.id, v_emp, NEW.amount, NEW.txn_date,
    'approved', COALESCE(NEW.note,'سلفة من خزنة مصنع الأعلاف'), NULL);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_feed_factory_link_advance ON public.feed_factory_treasury_txns;
CREATE TRIGGER trg_feed_factory_link_advance
AFTER INSERT OR UPDATE OF amount, party, note ON public.feed_factory_treasury_txns
FOR EACH ROW EXECUTE FUNCTION public.trg_feed_factory_link_advance();

CREATE OR REPLACE FUNCTION public.trg_meat_factory_link_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NEW.direction <> 'out' THEN RETURN NEW; END IF;
  IF NOT (public.hr_text_is_advance(NEW.reason) OR public.hr_text_is_advance(NEW.notes)) THEN RETURN NEW; END IF;
  v_emp := public.hr_match_employee_by_name(COALESCE(NEW.reason, NEW.notes));
  IF v_emp IS NULL THEN RETURN NEW; END IF;
  PERFORM public.hr_upsert_treasury_advance(
    'meat_factory_treasury_txns', NEW.id, v_emp, NEW.amount, NEW.txn_date,
    'approved', COALESCE(NEW.reason,'سلفة من خزنة مصنع اللحوم'), NULL);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_meat_factory_link_advance ON public.meat_factory_treasury_txns;
CREATE TRIGGER trg_meat_factory_link_advance
AFTER INSERT OR UPDATE OF amount, reason, notes ON public.meat_factory_treasury_txns
FOR EACH ROW EXECUTE FUNCTION public.trg_meat_factory_link_advance();

CREATE OR REPLACE FUNCTION public.trg_main_treasury_link_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NEW.txn_type NOT IN ('expense','withdrawal','out') THEN RETURN NEW; END IF;
  IF NOT public.hr_text_is_advance(NEW.description) THEN RETURN NEW; END IF;
  v_emp := public.hr_match_employee_by_name(NEW.counterparty);
  IF v_emp IS NULL THEN RETURN NEW; END IF;
  PERFORM public.hr_upsert_treasury_advance(
    'main_treasury_transactions', NEW.id, v_emp, NEW.amount, NEW.txn_date,
    public.hr_map_source_status(NEW.status::text),
    COALESCE(NEW.description,'سلفة من الخزنة الرئيسية'),
    NEW.rejection_reason);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_main_treasury_link_advance ON public.main_treasury_transactions;
CREATE TRIGGER trg_main_treasury_link_advance
AFTER INSERT OR UPDATE OF status, counterparty, amount, description, rejection_reason
ON public.main_treasury_transactions FOR EACH ROW EXECUTE FUNCTION public.trg_main_treasury_link_advance();

-- Views
CREATE OR REPLACE VIEW public.v_hr_treasury_advances AS
SELECT
  d.id AS hr_deduction_id,
  d.employee_id, e.full_name AS employee_name,
  split_part(replace(d.reference_id,'treasury_advance_',''),'_',1) AS source_table_part,
  d.reference_id, d.amount,
  d.deduction_date AS advance_date,
  d.month, d.year, d.status AS hr_status,
  (d.status='approved') AS deducted_from_salary,
  d.reason, d.rejection_reason, d.created_at, d.updated_at
FROM hr_deductions d
LEFT JOIN hr_employees e ON e.id=d.employee_id
WHERE d.deduction_type='advance_repayment'
  AND d.reference_id LIKE 'treasury_advance_%';
GRANT SELECT ON public.v_hr_treasury_advances TO authenticated;

CREATE OR REPLACE VIEW public.v_hr_treasury_advances_unmatched AS
SELECT 'lab_treasury_movements'::text AS source_table,
       m.id AS source_id, m.beneficiary AS recipient_name,
       m.amount, m.movement_date AS advance_date,
       m.status::text AS source_status,
       COALESCE(m.description, m.notes) AS reason
FROM lab_treasury_movements m
WHERE m.movement_type::text='expense'
  AND (public.hr_text_is_advance(m.description) OR public.hr_text_is_advance(m.notes))
  AND public.hr_match_employee_by_name(m.beneficiary) IS NULL
UNION ALL
SELECT 'lab_treasury_advances'::text, a.id, a.recipient_name, a.amount, a.issued_at::date,
       a.status::text, a.purpose
FROM lab_treasury_advances a
WHERE COALESCE((SELECT id FROM hr_employees WHERE user_id=a.employee_user_id LIMIT 1),
               public.hr_match_employee_by_name(a.recipient_name)) IS NULL
UNION ALL
SELECT 'slaughter_custody_expenses'::text, s.id, s.beneficiary, s.amount, s.expense_date,
       s.status::text, COALESCE(s.description, s.notes)
FROM slaughter_custody_expenses s
WHERE (public.hr_text_is_advance(s.description) OR public.hr_text_is_advance(s.notes)
       OR public.hr_text_is_advance(s.category::text))
  AND public.hr_match_employee_by_name(s.beneficiary) IS NULL
UNION ALL
SELECT 'main_treasury_transactions'::text, t.id, t.counterparty, t.amount, t.txn_date,
       t.status::text, t.description
FROM main_treasury_transactions t
WHERE t.txn_type IN ('expense','withdrawal','out')
  AND public.hr_text_is_advance(t.description)
  AND public.hr_match_employee_by_name(t.counterparty) IS NULL;
GRANT SELECT ON public.v_hr_treasury_advances_unmatched TO authenticated;

-- Backfill
DO $$
DECLARE r record; v_emp uuid;
BEGIN
  FOR r IN SELECT * FROM lab_treasury_movements
            WHERE movement_type::text='expense'
              AND movement_date >= DATE '2026-06-01'
              AND (public.hr_text_is_advance(description) OR public.hr_text_is_advance(notes))
  LOOP
    v_emp := public.hr_match_employee_by_name(r.beneficiary);
    IF v_emp IS NOT NULL THEN
      PERFORM public.hr_upsert_treasury_advance(
        'lab_treasury_movements', r.id, v_emp, r.amount, r.movement_date,
        public.hr_map_source_status(r.status::text),
        COALESCE(r.description, r.notes,'سلفة'), r.rejection_reason);
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM lab_treasury_advances WHERE issued_at::date >= DATE '2026-06-01'
  LOOP
    v_emp := COALESCE(
      (SELECT id FROM hr_employees WHERE user_id=r.employee_user_id LIMIT 1),
      public.hr_match_employee_by_name(r.recipient_name));
    IF v_emp IS NOT NULL THEN
      PERFORM public.hr_upsert_treasury_advance(
        'lab_treasury_advances', r.id, v_emp, r.amount, r.issued_at::date,
        public.hr_map_source_status(r.status::text),
        COALESCE(r.purpose,'سلفة موظف'), r.cancellation_reason);
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM slaughter_custody_expenses
            WHERE expense_date >= DATE '2026-06-01'
              AND (public.hr_text_is_advance(description) OR public.hr_text_is_advance(notes))
  LOOP
    v_emp := public.hr_match_employee_by_name(r.beneficiary);
    IF v_emp IS NOT NULL THEN
      PERFORM public.hr_upsert_treasury_advance(
        'slaughter_custody_expenses', r.id, v_emp, r.amount, r.expense_date,
        public.hr_map_source_status(r.status::text),
        COALESCE(r.description, r.notes,'سلفة'), r.rejection_reason);
    END IF;
  END LOOP;
END $$;
