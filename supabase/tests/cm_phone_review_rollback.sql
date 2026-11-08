-- Apply rollback of the page migration, prove the PR105 scanner and trigger
-- still run, then reapply the page migration. Customer rows roll back.
\ir ../rollbacks/20261108213000_cm_phone_review_page.sql

DO $$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.cm_phone_id_set_eq(uuid[],uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback left cm_phone_id_set_eq';
  END IF;
  IF to_regprocedure('public.cm_phone_review_list(date,text,text,int,int)') IS NOT NULL
     OR to_regprocedure('public.cm_correct_customer_phone(uuid,text,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback left a page RPC';
  END IF;
  IF to_regprocedure('public.cm_scan_phone_review(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'rollback dropped the scanner';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'cm_scan_phone_review';
  IF position('cm_phone_id_set_eq' IN v_src) > 0 THEN
    RAISE EXCEPTION 'restored scanner still calls cm_phone_id_set_eq';
  END IF;
  IF position('field_no' IN v_src) = 0 THEN
    RAISE EXCEPTION 'restored scanner is not the field-scoped PR105 body';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customers_cm_phone_review' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'rollback dropped the customer phone trigger';
  END IF;
END;
$$;

BEGIN;
INSERT INTO public.customers (name, phone, phone2)
VALUES ('تراجع فحص', '01077773001', '01077773001');
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.customers WHERE name = 'تراجع فحص';
  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE customer_id = v_id AND issue = 'two_numbers'
  ) THEN
    RAISE EXCEPTION 'restored scanner marked identical fields as two_numbers';
  END IF;
  UPDATE public.customers SET phone = '0223456789' WHERE id = v_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE customer_id = v_id AND issue = 'malformed' AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'restored trigger did not queue a malformed number';
  END IF;
END;
$$;
ROLLBACK;

\ir ../migrations/20261108213000_cm_phone_review_page.sql

DO $$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.cm_phone_id_set_eq(uuid[],uuid[])') IS NULL THEN
    RAISE EXCEPTION 'reapply did not restore cm_phone_id_set_eq';
  END IF;
  IF to_regprocedure('public.cm_phone_review_list(date,text,text,int,int)') IS NULL
     OR to_regprocedure('public.cm_correct_customer_phone(uuid,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'reapply did not restore the page RPCs';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'cm_scan_phone_review';
  IF position('cm_phone_id_set_eq' IN v_src) = 0 THEN
    RAISE EXCEPTION 'reapplied scanner does not reconcile groups';
  END IF;
END;
$$;

BEGIN;
DO $$
DECLARE
  v_id uuid := '00000000-0000-4000-8000-00000000f401';
BEGIN
  INSERT INTO public.customers (id, name, phone, phone2)
  VALUES (v_id, 'إعادة تطبيق', '01077773002', '01077773002');
  PERFORM public.cm_scan_phone_review(ARRAY[v_id]);
  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE customer_id = v_id AND issue = 'two_numbers'
  ) THEN
    RAISE EXCEPTION 'reapplied scanner marked identical fields as two_numbers';
  END IF;
END;
$$;
ROLLBACK;
