
-- Auto-link treasury advances to HR deductions (no new treasury movement created)

-- 1) Name normalization helper
CREATE OR REPLACE FUNCTION public.hr_norm_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    translate(coalesce(trim(p),''),
      'إأآا ىيؤئة',
      'اااا يي وءه'),
    '\s+', ' ', 'g'
  )
$$;

-- 2) Match employee by free-text name (exact, alias, then prefix)
CREATE OR REPLACE FUNCTION public.hr_match_employee_by_name(p_name text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_norm text;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN RETURN NULL; END IF;
  v_norm := public.hr_norm_name(p_name);

  SELECT id INTO v_id FROM hr_employees
   WHERE public.hr_norm_name(full_name) = v_norm AND status = 'active' LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT employee_id INTO v_id FROM hr_employee_name_aliases
   WHERE public.hr_norm_name(raw_name) = v_norm LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- partial: any employee whose normalized full_name contains all tokens of input
  SELECT id INTO v_id FROM hr_employees e
   WHERE status = 'active'
     AND public.hr_norm_name(e.full_name) ILIKE '%' || v_norm || '%'
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- reverse: input contains employee's first two tokens
  SELECT id INTO v_id FROM hr_employees e
   WHERE status = 'active'
     AND v_norm ILIKE '%' || public.hr_norm_name(e.full_name) || '%'
   LIMIT 1;
  RETURN v_id;
END $$;

-- 3) Upsert helper: create advance_repayment if not already linked
CREATE OR REPLACE FUNCTION public.hr_link_advance_to_employee(
  p_source_table text,
  p_source_id    uuid,
  p_employee_id  uuid,
  p_amount       numeric,
  p_date         date,
  p_reason       text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ref text; v_id uuid;
BEGIN
  IF p_employee_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN RETURN NULL; END IF;
  v_ref := p_source_table || '_advance_' || p_source_id::text || '_' || p_employee_id::text;

  SELECT id INTO v_id FROM hr_deductions WHERE reference_id = v_ref LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO hr_deductions(
    employee_id, deduction_date, month, year,
    deduction_type, amount, reason, status, reference_id, created_by
  ) VALUES (
    p_employee_id, p_date,
    EXTRACT(MONTH FROM p_date)::smallint,
    EXTRACT(YEAR  FROM p_date)::smallint,
    'advance_repayment', p_amount,
    COALESCE(p_reason, 'سلفة موظف من الخزنة'),
    'approved', v_ref, NULL
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 4) Detector: returns TRUE if text indicates an advance ("سلفة" / advance)
CREATE OR REPLACE FUNCTION public.hr_text_is_advance(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p,'') ~* '(سلفة|سلف|advance)'
$$;

-- 5) Trigger on lab_treasury_movements
CREATE OR REPLACE FUNCTION public.trg_lab_treasury_link_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NEW.status <> 'approved' OR NEW.movement_type::text <> 'expense' THEN RETURN NEW; END IF;
  IF NOT (public.hr_text_is_advance(NEW.description) OR public.hr_text_is_advance(NEW.notes)
          OR NEW.expense_category::text IN ('salaries_hatchery','salaries_mother_farm')) THEN
    RETURN NEW;
  END IF;
  -- Only treat salary categories as advance when text says so
  IF NEW.expense_category::text IN ('salaries_hatchery','salaries_mother_farm')
     AND NOT (public.hr_text_is_advance(NEW.description) OR public.hr_text_is_advance(NEW.notes)) THEN
    RETURN NEW;
  END IF;

  v_emp := public.hr_match_employee_by_name(NEW.beneficiary);
  IF v_emp IS NULL THEN RETURN NEW; END IF;

  PERFORM public.hr_link_advance_to_employee(
    'lab_treasury_movements', NEW.id, v_emp, NEW.amount, NEW.movement_date,
    COALESCE(NEW.description, NEW.notes, 'سلفة من خزنة المعمل')
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lab_treasury_link_advance ON public.lab_treasury_movements;
CREATE TRIGGER trg_lab_treasury_link_advance
AFTER INSERT OR UPDATE OF status, beneficiary, amount, description, notes
ON public.lab_treasury_movements
FOR EACH ROW EXECUTE FUNCTION public.trg_lab_treasury_link_advance();

-- 6) Trigger on lab_treasury_advances (dedicated advance table — most reliable)
CREATE OR REPLACE FUNCTION public.trg_lab_advances_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NEW.status NOT IN ('open','active','approved','settled') THEN RETURN NEW; END IF;
  v_emp := NEW.employee_user_id;
  IF v_emp IS NULL THEN
    v_emp := public.hr_match_employee_by_name(NEW.recipient_name);
  ELSE
    -- employee_user_id is auth user_id, map to hr_employees.id
    SELECT id INTO v_emp FROM hr_employees WHERE user_id = NEW.employee_user_id LIMIT 1;
    IF v_emp IS NULL THEN
      v_emp := public.hr_match_employee_by_name(NEW.recipient_name);
    END IF;
  END IF;
  IF v_emp IS NULL THEN RETURN NEW; END IF;

  PERFORM public.hr_link_advance_to_employee(
    'lab_treasury_advances', NEW.id, v_emp, NEW.amount, NEW.issued_at::date,
    COALESCE(NEW.purpose, 'سلفة موظف من خزنة المعمل')
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lab_advances_link ON public.lab_treasury_advances;
CREATE TRIGGER trg_lab_advances_link
AFTER INSERT OR UPDATE OF status, amount, employee_user_id, recipient_name
ON public.lab_treasury_advances
FOR EACH ROW EXECUTE FUNCTION public.trg_lab_advances_link();

-- 7) Trigger on slaughter_custody_expenses
CREATE OR REPLACE FUNCTION public.trg_slaughter_custody_link_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NEW.status <> 'approved' THEN RETURN NEW; END IF;
  IF NOT (public.hr_text_is_advance(NEW.description) OR public.hr_text_is_advance(NEW.notes)
          OR public.hr_text_is_advance(NEW.category::text)) THEN
    RETURN NEW;
  END IF;
  v_emp := public.hr_match_employee_by_name(NEW.beneficiary);
  IF v_emp IS NULL THEN RETURN NEW; END IF;
  PERFORM public.hr_link_advance_to_employee(
    'slaughter_custody_expenses', NEW.id, v_emp, NEW.amount, NEW.expense_date,
    COALESCE(NEW.description, NEW.notes, 'سلفة من عهدة المجزر')
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_slaughter_custody_link_advance ON public.slaughter_custody_expenses;
CREATE TRIGGER trg_slaughter_custody_link_advance
AFTER INSERT OR UPDATE OF status, beneficiary, amount, description, notes
ON public.slaughter_custody_expenses
FOR EACH ROW EXECUTE FUNCTION public.trg_slaughter_custody_link_advance();

-- 8) Trigger on feed_factory_treasury_txns
CREATE OR REPLACE FUNCTION public.trg_feed_factory_link_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NEW.direction <> 'out' THEN RETURN NEW; END IF;
  IF NOT (public.hr_text_is_advance(NEW.note) OR public.hr_text_is_advance(NEW.kind)) THEN RETURN NEW; END IF;
  v_emp := public.hr_match_employee_by_name(NEW.party);
  IF v_emp IS NULL THEN RETURN NEW; END IF;
  PERFORM public.hr_link_advance_to_employee(
    'feed_factory_treasury_txns', NEW.id, v_emp, NEW.amount, NEW.txn_date,
    COALESCE(NEW.note, 'سلفة من خزنة مصنع الأعلاف')
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_feed_factory_link_advance ON public.feed_factory_treasury_txns;
CREATE TRIGGER trg_feed_factory_link_advance
AFTER INSERT OR UPDATE OF amount, party, note
ON public.feed_factory_treasury_txns
FOR EACH ROW EXECUTE FUNCTION public.trg_feed_factory_link_advance();

-- 9) Trigger on meat_factory_treasury_txns
CREATE OR REPLACE FUNCTION public.trg_meat_factory_link_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid; v_name text;
BEGIN
  IF NEW.direction <> 'out' THEN RETURN NEW; END IF;
  IF NOT (public.hr_text_is_advance(NEW.reason) OR public.hr_text_is_advance(NEW.notes)) THEN RETURN NEW; END IF;
  -- best-effort: parse name from reason/notes
  v_name := COALESCE(NEW.reason, NEW.notes);
  v_emp := public.hr_match_employee_by_name(v_name);
  IF v_emp IS NULL THEN RETURN NEW; END IF;
  PERFORM public.hr_link_advance_to_employee(
    'meat_factory_treasury_txns', NEW.id, v_emp, NEW.amount, NEW.txn_date,
    COALESCE(NEW.reason, 'سلفة من خزنة مصنع اللحوم')
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_meat_factory_link_advance ON public.meat_factory_treasury_txns;
CREATE TRIGGER trg_meat_factory_link_advance
AFTER INSERT OR UPDATE OF amount, reason, notes
ON public.meat_factory_treasury_txns
FOR EACH ROW EXECUTE FUNCTION public.trg_meat_factory_link_advance();

-- 10) Trigger on main_treasury_transactions
CREATE OR REPLACE FUNCTION public.trg_main_treasury_link_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NEW.status NOT IN ('approved','posted','completed') THEN RETURN NEW; END IF;
  IF NEW.txn_type NOT IN ('expense','withdrawal','out') THEN RETURN NEW; END IF;
  IF NOT (public.hr_text_is_advance(NEW.description)) THEN RETURN NEW; END IF;
  v_emp := public.hr_match_employee_by_name(NEW.counterparty);
  IF v_emp IS NULL THEN RETURN NEW; END IF;
  PERFORM public.hr_link_advance_to_employee(
    'main_treasury_transactions', NEW.id, v_emp, NEW.amount, NEW.txn_date,
    COALESCE(NEW.description, 'سلفة من الخزنة الرئيسية')
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_main_treasury_link_advance ON public.main_treasury_transactions;
CREATE TRIGGER trg_main_treasury_link_advance
AFTER INSERT OR UPDATE OF status, counterparty, amount, description
ON public.main_treasury_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_main_treasury_link_advance();

-- 11) Backfill: scan existing approved advances since 2026-06-01 and link
DO $$
DECLARE r record; v_emp uuid;
BEGIN
  -- lab_treasury_movements
  FOR r IN SELECT * FROM lab_treasury_movements
            WHERE status='approved' AND movement_type::text='expense'
              AND movement_date >= DATE '2026-06-01'
              AND (public.hr_text_is_advance(description) OR public.hr_text_is_advance(notes))
  LOOP
    v_emp := public.hr_match_employee_by_name(r.beneficiary);
    IF v_emp IS NOT NULL THEN
      PERFORM public.hr_link_advance_to_employee(
        'lab_treasury_movements', r.id, v_emp, r.amount, r.movement_date,
        COALESCE(r.description, r.notes, 'سلفة')
      );
    END IF;
  END LOOP;

  -- slaughter_custody_expenses
  FOR r IN SELECT * FROM slaughter_custody_expenses
            WHERE status='approved' AND expense_date >= DATE '2026-06-01'
              AND (public.hr_text_is_advance(description) OR public.hr_text_is_advance(notes))
  LOOP
    v_emp := public.hr_match_employee_by_name(r.beneficiary);
    IF v_emp IS NOT NULL THEN
      PERFORM public.hr_link_advance_to_employee(
        'slaughter_custody_expenses', r.id, v_emp, r.amount, r.expense_date,
        COALESCE(r.description, r.notes, 'سلفة')
      );
    END IF;
  END LOOP;
END $$;
