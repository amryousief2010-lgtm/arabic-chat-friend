-- Same-moderator repeat-order warning. Scratch DB only:
--   createdb ownrepeat
--   psql -v ON_ERROR_STOP=1 -d ownrepeat -f supabase/tests/own_repeat_order_warning_scaffold.sql
--   psql -v ON_ERROR_STOP=1 -d ownrepeat -v phase=before -f supabase/tests/own_repeat_order_warning.sql
--   psql -v ON_ERROR_STOP=1 -d ownrepeat -f supabase/migrations/20261012010000_own_moderator_repeat_order_warning.sql
--   psql -v ON_ERROR_STOP=1 -d ownrepeat -v phase=after  -f supabase/tests/own_repeat_order_warning.sql
-- Real case: 01102626616 (حاتم محمد), مريم registered ORD-20261005-011956 (5/10 23:54 Cairo)
-- then a NEW customer record with the same phone and ORD-20261008-368847 (8/10 10:05 Cairo).

\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', u::text, true);
$$;

-- Fixtures (ids from production where real)
INSERT INTO public.profile_directory VALUES
  ('c641b892-a86c-4c33-8637-c6d095a5e10e', 'مريم'),
  ('00000000-0000-0000-0000-0000000000b2', 'نورا');

INSERT INTO public.customers (id, name, phone, address) VALUES
  ('85cc57c4-5ca7-4205-b1c3-be1d1ea6b358', 'حاتم محمد', '01102626616',
   'طنطا ش المعتصم مع السلطان مراد عند تراست ماركت عماره ٧١ الدور ٥'),
  -- second record, same phone (created by مريم on 8/10 instead of picking the existing one)
  ('08a465a1-e196-424d-b0bb-6db3a6a08e1a', 'حاتم محمد', '01102626616',
   'طنطا ش المعتصم مع السلطان عند تراست ماركت عماره ٧١ الدور ٥'),
  ('00000000-0000-0000-0000-0000000000c3', 'عميل تاني', '01000000003', 'القاهرة');

-- First order: ~58h before "now" (real gap 5/10 23:54 → 8/10 10:05), kept inside the
-- current Cairo month so the test is stable on any date.
INSERT INTO public.orders (id, order_number, customer_id, created_by, status, delivery_address,
                           shipping_company, fulfillment_type, total, created_at)
SELECT '4d75bbd9-2ffa-4420-9fd6-db2ecf27a069', 'ORD-20261005-011956',
       '85cc57c4-5ca7-4205-b1c3-be1d1ea6b358', 'c641b892-a86c-4c33-8637-c6d095a5e10e', 'delivered',
       'طنطا ش المعتصم مع السلطان مراد عند تراست ماركت عماره ٧١ الدور ٥', 'مندوب خاص', 'delivery', 1000,
       CASE WHEN date_trunc('month', timezone('Africa/Cairo', now() - interval '58 hours'))
                 = date_trunc('month', timezone('Africa/Cairo', now()))
            THEN now() - interval '58 hours' ELSE now() - interval '3 hours' END;
INSERT INTO public.order_items (order_id, product_name, offer_name, quantity, unit_price) VALUES
  ('4d75bbd9-2ffa-4420-9fd6-db2ecf27a069', 'برجر', 'عرض 4 كيلو', 1, 250),
  ('4d75bbd9-2ffa-4420-9fd6-db2ecf27a069', 'كفتة', 'عرض 4 كيلو', 1, 250),
  ('4d75bbd9-2ffa-4420-9fd6-db2ecf27a069', 'سجق', 'عرض 4 كيلو', 1, 250),
  ('4d75bbd9-2ffa-4420-9fd6-db2ecf27a069', 'مفروم', 'عرض 4 كيلو', 1, 250);

CREATE TEMP TABLE args AS SELECT
  '[{"product_name":"برجر","offer_name":"عرض 4 كيلو","quantity":1},
    {"product_name":"كفتة","offer_name":"عرض 4 كيلو","quantity":1},
    {"product_name":"كوارع","offer_name":"عرض 4 كيلو","quantity":0.5}]'::jsonb AS items;

SELECT pg_temp.as_user('c641b892-a86c-4c33-8637-c6d095a5e10e');

\if :{?phase}
\else
\set phase after
\endif

SELECT :'phase' = 'before' AS is_before \gset

\if :is_before
-- ===== BEFORE the migration: reproduces the miss =====
SELECT pg_temp.ok(
  (r->>'is_duplicate')::boolean = false
  AND COALESCE((r->>'is_own_repeat')::boolean, false) = false
  AND jsonb_array_length(r->'candidates') = 0,
  'BEFORE: مريم second order on new customer record → no warning (the bug)')
FROM (SELECT public.check_duplicate_order_attempt(
  '08a465a1-e196-424d-b0bb-6db3a6a08e1a', 'حاتم محمد', '01102626616',
  'طنطا ش المعتصم مع السلطان عند تراست ماركت عماره ٧١ الدور ٥', 'مندوب خاص', 'delivery',
  (SELECT items FROM args), NULL) r) x;

\else
-- ===== AFTER the migration =====

-- 1) Maryam case: warn with ORD-20261005-011956
SELECT public.check_duplicate_order_attempt(
  '08a465a1-e196-424d-b0bb-6db3a6a08e1a', 'حاتم محمد', '01102626616',
  'طنطا ش المعتصم مع السلطان عند تراست ماركت عماره ٧١ الدور ٥', 'مندوب خاص', 'delivery',
  (SELECT items FROM args), NULL) AS r1 \gset

SELECT pg_temp.ok((:'r1'::jsonb->>'is_own_repeat')::boolean, '1 is_own_repeat = true');
SELECT pg_temp.ok((:'r1'::jsonb->>'is_duplicate')::boolean = false, '1 not an approval-type duplicate');
SELECT pg_temp.ok(:'r1'::jsonb->'own_candidates'->0->>'order_number' = 'ORD-20261005-011956',
                  '1 candidate is ORD-20261005-011956');
SELECT pg_temp.ok((:'r1'::jsonb->'own_candidates'->0->>'matched_on_phone')::boolean, '1 matched on phone across customer records');
SELECT pg_temp.ok(:'r1'::jsonb->'own_candidates'->0->>'moderator_name' = 'مريم', '1 candidate moderator = مريم');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.duplicate_order_attempt_audit
                          WHERE id = (:'r1'::jsonb->>'attempt_id')::uuid AND status = 'own_repeat_detected'
                            AND matched_order_id = '4d75bbd9-2ffa-4420-9fd6-db2ecf27a069'),
                  '1 audit row own_repeat_detected');

-- 2) Confirmed retry → passes, no extra audit row
SELECT count(*) AS audit_before FROM public.duplicate_order_attempt_audit \gset
SELECT pg_temp.ok(
  (r->>'is_own_repeat')::boolean = false AND (r->>'is_duplicate')::boolean = false
  AND (r->>'is_double_submit')::boolean = false,
  '2 p_own_repeat_confirmed = true → clear')
FROM (SELECT public.check_duplicate_order_attempt(
  '08a465a1-e196-424d-b0bb-6db3a6a08e1a', 'حاتم محمد', '01102626616',
  'طنطا', 'مندوب خاص', 'delivery', (SELECT items FROM args), NULL, true) r) x;
SELECT pg_temp.ok((SELECT count(*) FROM public.duplicate_order_attempt_audit) = :audit_before,
                  '2 confirmed retry writes no audit row');

-- 3) Save ORD-20261008-368847 and log the confirmation
INSERT INTO public.orders (id, order_number, customer_id, created_by, status, total)
VALUES ('343d7c93-3178-4e08-b89d-a9e1a00a7f15', 'ORD-20261008-368847',
        '08a465a1-e196-424d-b0bb-6db3a6a08e1a', 'c641b892-a86c-4c33-8637-c6d095a5e10e', 'new', 1000);
SELECT pg_temp.ok(public.confirm_own_repeat_order_attempt((:'r1'::jsonb->>'attempt_id')::uuid,
                  '343d7c93-3178-4e08-b89d-a9e1a00a7f15'), '3 confirm logged');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.duplicate_order_attempt_audit
                          WHERE id = (:'r1'::jsonb->>'attempt_id')::uuid AND status = 'own_repeat_confirmed'
                            AND decision_by = 'c641b892-a86c-4c33-8637-c6d095a5e10e'
                            AND proposed_order->>'created_order_id' = '343d7c93-3178-4e08-b89d-a9e1a00a7f15'),
                  '3 audit → own_repeat_confirmed + created_order_id');
SELECT pg_temp.ok(NOT public.confirm_own_repeat_order_attempt((:'r1'::jsonb->>'attempt_id')::uuid,
                  '343d7c93-3178-4e08-b89d-a9e1a00a7f15'), '3 second confirm is a no-op');

-- 4) Another user cannot confirm مريم's attempt
SELECT public.check_duplicate_order_attempt(
  '08a465a1-e196-424d-b0bb-6db3a6a08e1a', 'حاتم محمد', '01102626616', NULL, NULL, 'delivery',
  '[{"product_name":"سجق"}]'::jsonb, NULL) AS r4 \gset
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
SELECT pg_temp.ok(NOT public.confirm_own_repeat_order_attempt((:'r4'::jsonb->>'attempt_id')::uuid,
                  '343d7c93-3178-4e08-b89d-a9e1a00a7f15'), '4 other user cannot confirm');

-- 5) Cross-moderator path unchanged: نورا sees approval-type duplicate
SELECT pg_temp.ok(
  (r->>'is_duplicate')::boolean AND NOT (r->>'is_own_repeat')::boolean
  AND r->'candidates' @> '[{"order_number":"ORD-20261005-011956"}]',
  '5 other moderator → approval flow (unchanged)')
FROM (SELECT public.check_duplicate_order_attempt(
  '85cc57c4-5ca7-4205-b1c3-be1d1ea6b358', 'حاتم محمد', '01102626616', NULL, NULL, 'delivery',
  (SELECT items FROM args), NULL) r) x;

-- 6) Cross-moderator takes precedence over own repeat (and confirm flag doesn't bypass it)
INSERT INTO public.orders (order_number, customer_id, created_by, status, total)
VALUES ('ORD-NORA-1', '85cc57c4-5ca7-4205-b1c3-be1d1ea6b358', '00000000-0000-0000-0000-0000000000b2', 'new', 500);
SELECT pg_temp.as_user('c641b892-a86c-4c33-8637-c6d095a5e10e');
SELECT pg_temp.ok(
  (r->>'is_duplicate')::boolean AND NOT (r->>'is_own_repeat')::boolean,
  '6 own + other moderator orders → approval flow wins, even with confirm flag')
FROM (SELECT public.check_duplicate_order_attempt(
  '08a465a1-e196-424d-b0bb-6db3a6a08e1a', 'حاتم محمد', '01102626616', NULL, NULL, 'delivery',
  (SELECT items FROM args), NULL, true) r) x;
DELETE FROM public.orders WHERE order_number = 'ORD-NORA-1';

-- 7) Phone in another format (+20 / spaces / Arabic digits) still matches
SELECT pg_temp.ok((r->>'is_own_repeat')::boolean, '7 "+20 110 262 ٦٦١٦" normalised → warned')
FROM (SELECT public.check_duplicate_order_attempt(
  '00000000-0000-0000-0000-0000000000c3', 'اسم مختلف', '+20 110 262 ٦٦١٦', NULL, NULL, 'delivery',
  '[]'::jsonb, NULL) r) x;

-- 8) Different phone → clear
SELECT pg_temp.ok(NOT (r->>'is_own_repeat')::boolean AND NOT (r->>'is_duplicate')::boolean, '8 different phone → clear')
FROM (SELECT public.check_duplicate_order_attempt(
  '00000000-0000-0000-0000-0000000000c3', 'عميل تاني', '01000000003', 'القاهرة', NULL, 'delivery',
  '[]'::jsonb, NULL) r) x;

-- 9) Cancelled own orders are ignored
UPDATE public.orders SET status = 'cancelled'
WHERE id IN ('4d75bbd9-2ffa-4420-9fd6-db2ecf27a069', '343d7c93-3178-4e08-b89d-a9e1a00a7f15');
SELECT pg_temp.ok(NOT (r->>'is_own_repeat')::boolean, '9 cancelled own orders → no warning')
FROM (SELECT public.check_duplicate_order_attempt(
  '08a465a1-e196-424d-b0bb-6db3a6a08e1a', 'حاتم محمد', '01102626616', NULL, NULL, 'delivery',
  '[]'::jsonb, NULL) r) x;

-- 10) Own order from a previous month and older than 24h → no warning
UPDATE public.orders SET status = 'delivered',
  created_at = date_trunc('month', now()) - interval '3 days'
WHERE id = '4d75bbd9-2ffa-4420-9fd6-db2ecf27a069';
SELECT pg_temp.ok(NOT (r->>'is_own_repeat')::boolean, '10 previous-month own order (>24h) → no warning')
FROM (SELECT public.check_duplicate_order_attempt(
  '08a465a1-e196-424d-b0bb-6db3a6a08e1a', 'حاتم محمد', '01102626616', NULL, NULL, 'delivery',
  '[]'::jsonb, NULL) r) x;

-- 11) Own order within the last 24h (even across a month boundary) → warning
UPDATE public.orders SET created_at = now() - interval '20 hours'
WHERE id = '4d75bbd9-2ffa-4420-9fd6-db2ecf27a069';
SELECT pg_temp.ok((r->>'is_own_repeat')::boolean, '11 own order in last 24h → warning')
FROM (SELECT public.check_duplicate_order_attempt(
  '08a465a1-e196-424d-b0bb-6db3a6a08e1a', 'حاتم محمد', '01102626616', NULL, NULL, 'delivery',
  '[]'::jsonb, NULL) r) x;

-- 12) Double submit (same customer record, same items, <2 min) still wins
INSERT INTO public.orders (id, order_number, customer_id, created_by, status, created_at)
VALUES ('00000000-0000-0000-0000-00000000d001', 'ORD-DBL', '00000000-0000-0000-0000-0000000000c3',
        'c641b892-a86c-4c33-8637-c6d095a5e10e', 'new', now() - interval '30 seconds');
INSERT INTO public.order_items (order_id, product_name, offer_name, quantity) VALUES
  ('00000000-0000-0000-0000-00000000d001', 'سجق', NULL, 1);
SELECT pg_temp.ok((r->>'is_double_submit')::boolean, '12 double submit unchanged')
FROM (SELECT public.check_duplicate_order_attempt(
  '00000000-0000-0000-0000-0000000000c3', 'عميل تاني', '01000000003', NULL, NULL, 'delivery',
  '[{"product_name":"سجق","quantity":1}]'::jsonb, NULL) r) x;

-- 13) Privileges: anon cannot execute; one check_duplicate_order_attempt overload only
SELECT pg_temp.ok(NOT has_function_privilege('anon',
  'public.check_duplicate_order_attempt(uuid,text,text,text,text,text,jsonb,text,boolean)', 'EXECUTE'),
  '13 anon has no EXECUTE');
SELECT pg_temp.ok((SELECT count(*) FROM pg_proc WHERE proname = 'check_duplicate_order_attempt') = 1,
  '13 single overload (old 8-arg dropped)');
SELECT pg_temp.ok(has_function_privilege('authenticated',
  'public.confirm_own_repeat_order_attempt(uuid,uuid)', 'EXECUTE'), '13 authenticated can confirm');
\endif

ROLLBACK;
