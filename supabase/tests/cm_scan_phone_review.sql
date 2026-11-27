-- Regressions for cm_scan_phone_review.
-- 1. The same single number in phone and phone2 is not two_numbers.
-- 2. The customer trigger warning carries SQLSTATE only, never SQLERRM.
-- 3. A closed multi_customer row stays closed for the same customer set and
--    reopens in place when the set changes. One row per phone, no second open row.
-- Inserts roll back. Helpers are created inside this transaction when step 2
-- is not on the database yet.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_phone_eg(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s text := COALESCE(input, '');
BEGIN
  s := translate(s, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  s := regexp_replace(trim(s), '[^0-9+]', '', 'g');
  IF s LIKE '+20%' THEN
    s := substr(s, 4);
  ELSIF s LIKE '0020%' THEN
    s := substr(s, 5);
  ELSIF s ~ '^20[0-9]{10}$' THEN
    s := substr(s, 3);
  END IF;
  IF s ~ '^1[0-9]{9}$' THEN
    s := '0' || s;
  END IF;
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION public.cm_normalize_phone(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := public.normalize_phone_eg(_raw);
BEGIN
  IF v ~ '^0201[0-9]{9}$' THEN v := substr(v, 3);
  ELSIF v ~ '^201[0-9]{9}$' THEN v := substr(v, 2);
  END IF;
  RETURN nullif(v, '');
END;
$$;

CREATE OR REPLACE FUNCTION public.cm_phone_is_valid(_norm text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$ SELECT coalesce(_norm ~ '^01[0125][0-9]{8}$', false) $$;

CREATE OR REPLACE FUNCTION public.cm_split_phone_field(_raw text)
RETURNS SETOF text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  p text;
  d text;
BEGIN
  IF _raw IS NULL OR btrim(_raw) = '' THEN RETURN; END IF;
  d := regexp_replace(translate(_raw, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g');
  IF d ~ '^01[0-9]{9}01[0-9]{9}$' THEN
    RETURN NEXT substr(d, 1, 11);
    RETURN NEXT substr(d, 12, 11);
    RETURN;
  END IF;
  FOR p IN
    SELECT btrim(x)
    FROM regexp_split_to_table(_raw, '\s*[/,;|،\\]\s*|\s+و\s+|\s{2,}|\s*-\s+|\s+-\s*') x
  LOOP
    IF p <> '' THEN RETURN NEXT p; END IF;
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS public.cm_customer_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merged_customer_id uuid NOT NULL,
  undone_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.cm_phone_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue text NOT NULL CHECK (issue IN ('malformed', 'two_numbers', 'multi_customer')),
  customer_id uuid,
  phone_raw text,
  phone_norm text,
  related_customer_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cm_phone_review_queue_uniq
  ON public.cm_phone_review_queue (issue, customer_id, phone_raw, phone_norm) NULLS NOT DISTINCT;

DO $$
DECLARE
  v_same uuid := '00000000-0000-4000-8000-00000000e101';
  v_split uuid := '00000000-0000-4000-8000-00000000e102';
  v_a uuid := '00000000-0000-4000-8000-00000000e201';
  v_b uuid := '00000000-0000-4000-8000-00000000e202';
  v_c uuid := '00000000-0000-4000-8000-00000000e203';
  v_d uuid := '00000000-0000-4000-8000-00000000e204';
  v_src text;
  v_ids uuid[];
  v_status text;
  v_resolution text;
  v_n int;
  v_phone constant text := '01077770001';
  v_shared constant text := '01077770041';
BEGIN
  IF to_regprocedure('public.cm_scan_phone_review(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'cm_scan_phone_review is not installed';
  END IF;

  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cm_customers_phone_review_trg';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'phone review trigger function is missing';
  END IF;
  IF position('SQLERRM' IN upper(v_src)) > 0 THEN
    RAISE EXCEPTION 'trigger function includes SQLERRM';
  END IF;
  IF v_src !~ 'RAISE WARNING ''cm_scan_phone_review skipped for customer % \(SQLSTATE %\)'', NEW\.id, SQLSTATE' THEN
    RAISE EXCEPTION 'trigger warning is not the redacted SQLSTATE form';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customers c
    WHERE public.cm_normalize_phone(c.phone) IN (v_phone, '01077770002', '01077770003', v_shared, '01077770099')
       OR public.cm_normalize_phone(c.phone2) IN (v_phone, '01077770002', '01077770003', v_shared, '01077770099')
  ) THEN
    RAISE EXCEPTION 'fixture phones already exist';
  END IF;

  INSERT INTO public.customers (id, name, phone, phone2)
  VALUES (v_same, 'same both fields', v_phone, v_phone);

  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE issue = 'two_numbers' AND customer_id = v_same
  ) THEN
    RAISE EXCEPTION 'identical phone and phone2 emitted two_numbers';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE issue = 'multi_customer' AND phone_norm = v_phone
  ) THEN
    RAISE EXCEPTION 'one customer with the same number in both fields emitted multi_customer';
  END IF;

  PERFORM public.cm_scan_phone_review(ARRAY[v_same]);
  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE issue = 'two_numbers' AND customer_id = v_same
  ) THEN
    RAISE EXCEPTION 'rescan still emitted two_numbers for identical phone and phone2';
  END IF;

  INSERT INTO public.customers (id, name, phone, phone2)
  VALUES (v_split, 'split one field', '01077770002 / 01077770003', '01077770002');

  SELECT count(*) INTO v_n
  FROM public.cm_phone_review_queue
  WHERE issue = 'two_numbers' AND customer_id = v_split;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected one two_numbers row for the split field, got %', v_n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE issue = 'two_numbers'
      AND customer_id = v_split
      AND phone_raw = '01077770002 / 01077770003'
  ) THEN
    RAISE EXCEPTION 'two_numbers row is not the field that actually contained two numbers';
  END IF;

  INSERT INTO public.customers (id, name, phone) VALUES
    (v_a, 'share a', v_shared),
    (v_b, 'share b', v_shared);

  SELECT count(*), min(status), (array_agg(related_customer_ids))[1]
  INTO v_n, v_status, v_ids
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = v_shared;
  IF v_n <> 1 OR v_status <> 'open' THEN
    RAISE EXCEPTION 'expected one open multi_customer row, got % %', v_n, v_status;
  END IF;
  IF NOT (v_ids @> ARRAY[v_a, v_b] AND v_ids <@ ARRAY[v_a, v_b]) THEN
    RAISE EXCEPTION 'unexpected initial set %', v_ids;
  END IF;

  UPDATE public.cm_phone_review_queue
  SET status = 'dismissed',
      resolution = 'dismissed',
      related_customer_ids = ARRAY[v_b, v_a]
  WHERE issue = 'multi_customer' AND phone_norm = v_shared;

  PERFORM public.cm_scan_phone_review(NULL);
  SELECT count(*), min(status), min(resolution), (array_agg(related_customer_ids))[1]
  INTO v_n, v_status, v_resolution, v_ids
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = v_shared;
  IF v_n <> 1 OR v_status <> 'dismissed' OR v_resolution IS DISTINCT FROM 'dismissed' THEN
    RAISE EXCEPTION 'identical set reopened a dismissed row (% % %)', v_n, v_status, v_resolution;
  END IF;

  INSERT INTO public.customers (id, name, phone) VALUES (v_c, 'share c', v_shared);
  SELECT count(*), min(status), min(resolution), (array_agg(related_customer_ids))[1]
  INTO v_n, v_status, v_resolution, v_ids
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = v_shared;
  IF v_n <> 1 OR v_status <> 'open' OR v_resolution IS NOT NULL THEN
    RAISE EXCEPTION 'changed set did not reopen the same row (% % %)', v_n, v_status, v_resolution;
  END IF;
  IF NOT (v_ids @> ARRAY[v_a, v_b, v_c] AND v_ids <@ ARRAY[v_a, v_b, v_c]) THEN
    RAISE EXCEPTION 'reopened set is %', v_ids;
  END IF;

  UPDATE public.cm_phone_review_queue
  SET status = 'resolved', resolution = 'merged', resolved_at = now()
  WHERE issue = 'multi_customer' AND phone_norm = v_shared;

  UPDATE public.customers SET phone = '01077770099' WHERE id = v_b;
  PERFORM public.cm_scan_phone_review(ARRAY[v_a]);
  SELECT count(*), min(status), min(resolution), (array_agg(related_customer_ids))[1]
  INTO v_n, v_status, v_resolution, v_ids
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = v_shared;
  IF v_n <> 1 OR v_status <> 'open' OR v_resolution IS NOT NULL THEN
    RAISE EXCEPTION 'smaller changed set stayed closed (% %)', v_n, v_status;
  END IF;
  IF NOT (v_ids @> ARRAY[v_a, v_c] AND v_ids <@ ARRAY[v_a, v_c]) THEN
    RAISE EXCEPTION 'smaller set is %', v_ids;
  END IF;

  INSERT INTO public.customers (id, name, phone) VALUES (v_d, 'share d', v_shared);
  SELECT count(*) INTO v_n
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = v_shared AND status = 'open';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'open multi_customer row was duplicated (% rows)', v_n;
  END IF;
  SELECT related_customer_ids INTO v_ids
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = v_shared;
  IF NOT (v_ids @> ARRAY[v_a, v_c, v_d] AND v_ids <@ ARRAY[v_a, v_c, v_d]) THEN
    RAISE EXCEPTION 'open set after another customer is %', v_ids;
  END IF;
END;
$$;

-- A scan error must not abort the customer save, and the warning path is the
-- redacted trigger above (already asserted to omit SQLERRM).
CREATE OR REPLACE FUNCTION public.cm_scan_phone_review(_customer_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'sensitive 01077770999';
END;
$$;

DO $$
DECLARE
  v_saved uuid := '00000000-0000-4000-8000-00000000e301';
BEGIN
  INSERT INTO public.customers (id, name, phone) VALUES (v_saved, 'save survives', '01077770991');
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = v_saved) THEN
    RAISE EXCEPTION 'customer save was blocked by the scan error';
  END IF;
END;
$$;

ROLLBACK;
