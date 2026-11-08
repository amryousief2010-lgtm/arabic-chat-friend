-- Phone review list, month filter, and field correction.
-- Standalone: rolls back its own transaction.
-- Included from cm_phone_review_rehearsal.sql: the outer transaction owns rollback
-- (\set phone_review_outer_tx 1). Do not COMMIT.
\if :{?phone_review_outer_tx}
\else
BEGIN;
\endif

DO $$
DECLARE
  v_gm uuid := '00000000-0000-4000-8000-00000000f101';
  v_mod uuid := '00000000-0000-4000-8000-00000000f102';
  v_msm uuid := '00000000-0000-4000-8000-00000000f103';
  v_sm uuid := '00000000-0000-4000-8000-00000000f105';
  v_gate uuid := '00000000-0000-4000-8000-00000000f205';
  v_same uuid := '00000000-0000-4000-8000-00000000f201';
  v_split uuid := '00000000-0000-4000-8000-00000000f202';
  v_a uuid := '00000000-0000-4000-8000-00000000f301';
  v_b uuid := '00000000-0000-4000-8000-00000000f302';
  v_c uuid := '00000000-0000-4000-8000-00000000f303';
  v_old uuid := '00000000-0000-4000-8000-00000000f304';
  v_list jsonb;
  v_phone text;
  v_phone2 text;
  v_total numeric;
  v_status text;
  v_ids uuid[];
  v_n int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_gm, 'phone-review-gm@example.com'),
    (v_mod, 'phone-review-mod@example.com'),
    (v_msm, 'phone-review-msm@example.com'),
    (v_sm, 'phone-review-sm@example.com');
  -- New users receive sales_moderator. Replace that default for the other roles.
  DELETE FROM public.user_roles WHERE user_id IN (v_gm, v_msm, v_sm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_gm, 'general_manager'),
    (v_msm, 'marketing_sales_manager'),
    (v_sm, 'sales_manager');
  INSERT INTO public.cm_feature_gate_allowlist (user_id, note)
  VALUES (v_msm, 'اختبار مراجعة الأرقام')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.customers (id, name, phone, phone2) VALUES
    (v_same, 'عميل اختبار متطابق', '01077771001', '01077771001'),
    (v_split, 'عميل اختبار حقلين', '01077771002 / 01077771003', NULL),
    (v_a, 'عميل اختبار أ', '01077771041', NULL),
    (v_b, 'عميل اختبار ب', '01077771041', NULL),
    (v_c, 'عميل اختبار ج', '01077771055', '01077771041'),
    (v_old, 'عميل اختبار قديم', '0223456789', NULL),
    (v_gate, 'عميل اختبار البوابة', '01077771088', NULL);

  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE customer_id = v_same AND issue = 'two_numbers'
  ) THEN
    RAISE EXCEPTION 'identical phone and phone2 emitted two_numbers';
  END IF;

  INSERT INTO public.orders (order_number, customer_id, status, total, created_at, moderator) VALUES
    ('ORD-TEST-NOV', v_a, 'pending', 150, timestamptz '2026-11-08 10:00:00+02', 'اختبار'),
    ('ORD-TEST-OLD', v_old, 'delivered', 80, timestamptz '2026-01-15 10:00:00+02', 'اختبار'),
    ('ORD-TEST-B', v_b, 'shipped', 40, timestamptz '2026-01-20 10:00:00+02', 'اختبار');

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_list := public.cm_phone_review_list('2026-11-01', NULL, NULL, 1, 25);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_list->'items') item
    WHERE item->>'issue' = 'multi_customer'
      AND item->>'phone_norm' = '01077771041'
      AND (
        SELECT count(*) FROM jsonb_array_elements(item->'customers')
      ) = 3
  ) THEN
    RAISE EXCEPTION 'November page did not keep every duplicate-group member';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_list->'items') item
    WHERE item->'customers' @> jsonb_build_array(jsonb_build_object('id', v_old::text))
       OR (item->>'phone_raw') = '0223456789'
  ) THEN
    RAISE EXCEPTION 'customer with only a January order appeared in November';
  END IF;

  v_list := public.cm_phone_review_list(NULL, NULL, 'ORD-TEST-NOV', 1, 25);
  IF (v_list->>'total')::int < 1 THEN
    RAISE EXCEPTION 'search by order number missed the group';
  END IF;

  v_list := public.cm_phone_review_list(NULL, 'malformed', NULL, 1, 1);
  IF (v_list->>'page_size')::int <> 1 OR jsonb_array_length(v_list->'items') > 1 THEN
    RAISE EXCEPTION 'page size was not honored';
  END IF;
  IF (v_list->>'total')::int < jsonb_array_length(v_list->'items') THEN
    RAISE EXCEPTION 'total is smaller than the page';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_mod::text, true);
  BEGIN
    PERFORM public.cm_correct_customer_phone(v_split, 'phone', '01077771009', false);
    RAISE EXCEPTION 'moderator correction was allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_sm::text, true);
  BEGIN
    PERFORM public.cm_phone_review_list('2026-11-01', NULL, NULL, 1, 25);
    RAISE EXCEPTION 'gate-denied sales manager listed the queue';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.cm_correct_customer_phone(v_gate, 'phone', '01077771089', false);
    RAISE EXCEPTION 'gate-denied sales manager corrected a phone';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF (SELECT phone FROM public.customers WHERE id = v_gate) IS DISTINCT FROM '01077771088' THEN
    RAISE EXCEPTION 'gate-denied correction changed the phone';
  END IF;
  INSERT INTO public.cm_feature_gate_allowlist (user_id, note)
  VALUES (v_sm, 'مديرة مبيعات مسموح لها بالبوابة')
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM public.cm_correct_customer_phone(v_gate, 'phone', '01077771089', false);
  IF (SELECT phone FROM public.customers WHERE id = v_gate) IS DISTINCT FROM '01077771089' THEN
    RAISE EXCEPTION 'allowlisted sales manager correction did not save';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_msm::text, true);
  BEGIN
    PERFORM public.cm_correct_customer_phone(v_split, 'phone', '01077771009', false);
    RAISE EXCEPTION 'marketing-only correction was allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.cm_phone_review_list('2026-11-01', 'multi_customer', NULL, 1, 25);
    RAISE EXCEPTION 'marketing-only list was allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  BEGIN
    PERFORM public.cm_correct_customer_phone(v_split, 'phone', '01077771002', false);
    RAISE EXCEPTION 'dropping a second number was saved without confirmation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'CM_PHONE_DROP_CONFIRM' THEN
      RAISE;
    END IF;
  END;
  SELECT phone INTO v_phone FROM public.customers WHERE id = v_split;
  IF v_phone IS DISTINCT FROM '01077771002 / 01077771003' THEN
    RAISE EXCEPTION 'unconfirmed correction changed the field';
  END IF;

  BEGIN
    PERFORM public.cm_correct_customer_phone(v_split, 'phone', '0223456789', true);
    RAISE EXCEPTION 'invalid number was saved';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  PERFORM public.cm_correct_customer_phone(v_split, 'phone', '01077771002', true);
  SELECT phone, phone2 INTO v_phone, v_phone2 FROM public.customers WHERE id = v_split;
  IF v_phone IS DISTINCT FROM '01077771002' OR v_phone2 IS NOT NULL THEN
    RAISE EXCEPTION 'correction did not keep only the chosen field';
  END IF;
  SELECT total INTO v_total FROM public.orders WHERE order_number = 'ORD-TEST-NOV';
  IF v_total IS DISTINCT FROM 150 THEN
    RAISE EXCEPTION 'order row changed during phone correction';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE customer_id = v_split AND issue = 'two_numbers' AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'corrected two_numbers row stayed open';
  END IF;

  SELECT status, related_customer_ids INTO v_status, v_ids
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = '01077771041';
  IF v_status IS DISTINCT FROM 'open' OR NOT (v_ids @> ARRAY[v_a, v_b, v_c] AND v_ids <@ ARRAY[v_a, v_b, v_c]) THEN
    RAISE EXCEPTION 'shared number was closed while three customers still have it';
  END IF;

  UPDATE public.cm_phone_review_queue
  SET status = 'dismissed', resolution = 'dismissed', related_customer_ids = ARRAY[v_c, v_b, v_a]
  WHERE issue = 'multi_customer' AND phone_norm = '01077771041';
  PERFORM public.cm_scan_phone_review(ARRAY[v_a]);
  SELECT status, count(*) INTO v_status, v_n
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = '01077771041'
  GROUP BY status;
  IF v_n IS DISTINCT FROM 1 OR v_status IS DISTINCT FROM 'dismissed' THEN
    RAISE EXCEPTION 'identical dismissed group was reopened';
  END IF;

  PERFORM public.cm_correct_customer_phone(v_c, 'phone2', '01077771077', false);
  SELECT status, related_customer_ids INTO v_status, v_ids
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = '01077771041';
  IF v_status IS DISTINCT FROM 'open' OR NOT (v_ids @> ARRAY[v_a, v_b] AND v_ids <@ ARRAY[v_a, v_b]) THEN
    RAISE EXCEPTION 'remaining duplicate pair was not kept open, status % ids %', v_status, v_ids;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE issue = 'multi_customer' AND phone_norm = '01077771041' AND status = 'open'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate open rows were created';
  END IF;
END;
$$;

\if :{?phone_review_outer_tx}
\else
ROLLBACK;
\endif
