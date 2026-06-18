CREATE OR REPLACE FUNCTION public.trg_slaughter_custody_link_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_emp uuid;
  v_match_text text;
BEGIN
  IF NOT (
    public.hr_text_is_advance(NEW.description)
    OR public.hr_text_is_advance(NEW.notes)
    OR public.hr_text_is_advance(NEW.category::text)
    OR public.hr_text_is_advance(NEW.beneficiary)
  ) THEN
    RETURN NEW;
  END IF;

  v_match_text := concat_ws(' ', NEW.beneficiary, NEW.description, NEW.notes, NEW.category::text);
  v_emp := public.hr_match_employee_by_name(v_match_text);
  IF v_emp IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.hr_upsert_treasury_advance(
    'slaughter_custody_expenses', NEW.id, v_emp, NEW.amount, NEW.expense_date,
    public.hr_map_source_status(NEW.status::text),
    COALESCE(NEW.description, NEW.notes, 'سلفة موظف معتمدة من عهدة المجزر'),
    NEW.rejection_reason
  );
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.trg_lab_treasury_link_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_emp uuid;
  v_match_text text;
BEGIN
  IF NEW.movement_type::text <> 'expense' THEN
    RETURN NEW;
  END IF;
  IF NOT (
    public.hr_text_is_advance(NEW.description)
    OR public.hr_text_is_advance(NEW.notes)
    OR public.hr_text_is_advance(NEW.beneficiary)
    OR public.hr_text_is_advance(NEW.expense_category::text)
  ) THEN
    RETURN NEW;
  END IF;

  v_match_text := concat_ws(' ', NEW.beneficiary, NEW.description, NEW.notes, NEW.expense_category::text);
  v_emp := public.hr_match_employee_by_name(v_match_text);
  IF v_emp IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.hr_upsert_treasury_advance(
    'lab_treasury_movements', NEW.id, v_emp, NEW.amount, NEW.movement_date,
    public.hr_map_source_status(NEW.status::text),
    COALESCE(NEW.description, NEW.notes, 'سلفة موظف معتمدة من خزنة المعمل'),
    NEW.rejection_reason
  );
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.trg_main_treasury_link_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_emp uuid;
  v_match_text text;
BEGIN
  IF NEW.txn_type NOT IN ('expense', 'withdrawal', 'out') THEN
    RETURN NEW;
  END IF;
  IF NOT (
    public.hr_text_is_advance(NEW.description)
    OR public.hr_text_is_advance(NEW.counterparty)
    OR public.hr_text_is_advance(NEW.deposit_purpose)
  ) THEN
    RETURN NEW;
  END IF;

  v_match_text := concat_ws(' ', NEW.counterparty, NEW.description, NEW.deposit_purpose);
  v_emp := public.hr_match_employee_by_name(v_match_text);
  IF v_emp IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.hr_upsert_treasury_advance(
    'main_treasury_transactions', NEW.id, v_emp, NEW.amount, NEW.txn_date,
    public.hr_map_source_status(NEW.status::text),
    COALESCE(NEW.description, 'سلفة موظف معتمدة من الخزنة الرئيسية'),
    NEW.rejection_reason
  );
  RETURN NEW;
END
$function$;