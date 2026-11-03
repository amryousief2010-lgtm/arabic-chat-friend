-- Rolling 7-day duplicate window. Throwaway database only:
--   createdb dup7d
--   psql -v ON_ERROR_STOP=1 -d dup7d -f supabase/tests/duplicate_order_rolling_7d.sql
--
-- Installs the previous coceg-prod bodies (supabase/rollbacks/...), asserts the
-- miss, applies supabase/migrations/20261102220000_duplicate_order_rolling_7d.sql,
-- then asserts the new window. The transaction is rolled back.

\set ON_ERROR_STOP 1

DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

BEGIN;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM (
    'sales_moderator', 'marketing_sales_manager', 'general_manager', 'executive_manager'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE public.profile_directory (id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, phone text, phone2 text, address text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text, customer_id uuid REFERENCES public.customers(id),
  created_by uuid, status text, delivery_address text, shipping_company text,
  fulfillment_type text, total numeric DEFAULT 0, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id),
  product_name text, offer_name text, quantity numeric, unit_price numeric
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text, description text, type text, order_id uuid, target_user_id uuid
);
CREATE TABLE public.test_sales_moderators (id uuid PRIMARY KEY);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT _role = 'sales_moderator'::public.app_role
     AND EXISTS (SELECT 1 FROM public.test_sales_moderators m WHERE m.id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.normalize_phone_eg(input text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $function$
DECLARE
  s text := COALESCE(input, '');
BEGIN
  s := translate(s, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  s := regexp_replace(trim(s), '[^0-9+]', '', 'g');
  IF s LIKE '+20%' THEN s := substr(s, 4);
  ELSIF s LIKE '0020%' THEN s := substr(s, 5);
  ELSIF s ~ '^20[0-9]{10}$' THEN s := substr(s, 3);
  END IF;
  IF s ~ '^1[0-9]{9}$' THEN s := '0' || s; END IF;
  RETURN s;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_match_text(input text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT trim(regexp_replace(lower(COALESCE(input, '')), '\s+', ' ', 'g'));
$function$;

CREATE OR REPLACE FUNCTION public.order_items_signature_from_json(p_items jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT COALESCE(string_agg(DISTINCT public.normalize_match_text(COALESCE(NULLIF(elem->>'offer_name',''), NULLIF(elem->>'product_name',''))), '|' ORDER BY public.normalize_match_text(COALESCE(NULLIF(elem->>'offer_name',''), NULLIF(elem->>'product_name','')))), '')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) elem
  WHERE trim(COALESCE(NULLIF(elem->>'offer_name',''), NULLIF(elem->>'product_name',''))) <> '';
$function$;

CREATE OR REPLACE FUNCTION public.order_items_signature_from_order(p_order_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT COALESCE(string_agg(DISTINCT public.normalize_match_text(COALESCE(NULLIF(oi.offer_name,''), oi.product_name)), '|' ORDER BY public.normalize_match_text(COALESCE(NULLIF(oi.offer_name,''), oi.product_name))), '')
  FROM public.order_items oi WHERE oi.order_id = p_order_id;
$function$;

CREATE OR REPLACE FUNCTION public.order_items_summary_from_order(p_order_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT COALESCE(string_agg(item_label, '، ' ORDER BY item_label), '')
  FROM (SELECT DISTINCT trim(COALESCE(NULLIF(oi.offer_name,''), oi.product_name)) || ' × ' || trim(to_char(oi.quantity, 'FM999999990.##')) AS item_label
        FROM public.order_items oi WHERE oi.order_id = p_order_id) s;
$function$;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', u::text, true);
$$;

-- Previous production definitions.
\ir ../rollbacks/20261102220000_duplicate_order_rolling_7d.sql

DROP TRIGGER IF EXISTS trg_notify_duplicate_customer_order_monthly ON public.orders;
CREATE TRIGGER trg_notify_duplicate_customer_order_monthly
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_duplicate_customer_order_monthly();

INSERT INTO public.profile_directory VALUES
  ('1484a421-bd24-4378-b272-0794a97e88e0', 'مودريتور أ'),
  ('295046a4-aea0-4eb4-a069-85a68cc30cb3', 'مودريتور ب');
INSERT INTO public.test_sales_moderators VALUES
  ('1484a421-bd24-4378-b272-0794a97e88e0'),
  ('295046a4-aea0-4eb4-a069-85a68cc30cb3');

INSERT INTO public.customers (id, name, phone, phone2) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'نور احمد', '01062175516', NULL),
  ('00000000-0000-0000-0000-0000000000a2', 'نور احمد', '01062175516', NULL),
  ('00000000-0000-0000-0000-0000000000b1', 'عميل حديث', '01000000011', NULL),
  ('00000000-0000-0000-0000-0000000000c1', 'عميل قديم', '01000000022', NULL),
  ('00000000-0000-0000-0000-0000000000d1', 'عميل ملغي', '01000000033', NULL),
  ('00000000-0000-0000-0000-0000000000e1', 'عميل نفس المودريتور', '01000000044', NULL),
  ('00000000-0000-0000-0000-0000000000f1', 'عميل هاتف ٢', NULL, '٠١٠٥٥٥٥٦٦٧٧'),
  ('00000000-0000-0000-0000-0000000000f2', 'عميل تنسيق', '+20 106 217 0000', NULL),
  ('00000000-0000-0000-0000-0000000000f5', 'أصل التنسيق', '01062170000', NULL);

-- Cross-month candidate. 96h ago when that is already last Cairo month
-- (the ORD-20261028 / ORD-20261101 shape, ~4 days). Otherwise pin it to
-- one second before this Cairo month so it is still a previous-month order.
INSERT INTO public.orders (id, order_number, customer_id, created_by, status, created_at)
SELECT '00000000-0000-0000-0000-00000000c055', 'ORD-CROSS',
       '00000000-0000-0000-0000-0000000000a1', '1484a421-bd24-4378-b272-0794a97e88e0', 'delivered',
       CASE
         WHEN date_trunc('month', timezone('Africa/Cairo', now() - interval '96 hours'))
              <> date_trunc('month', timezone('Africa/Cairo', now()))
         THEN now() - interval '96 hours'
         ELSE (date_trunc('month', timezone('Africa/Cairo', now())) AT TIME ZONE 'Africa/Cairo') - interval '1 second'
       END;

INSERT INTO public.orders (order_number, customer_id, created_by, status, created_at) VALUES
  ('ORD-RECENT', '00000000-0000-0000-0000-0000000000b1', '1484a421-bd24-4378-b272-0794a97e88e0', 'new', now() - interval '1 hour'),
  ('ORD-OLD', '00000000-0000-0000-0000-0000000000c1', '1484a421-bd24-4378-b272-0794a97e88e0', 'delivered',
    (date_trunc('month', timezone('Africa/Cairo', now())) AT TIME ZONE 'Africa/Cairo') - interval '10 days'),
  ('ORD-CANCEL', '00000000-0000-0000-0000-0000000000d1', '1484a421-bd24-4378-b272-0794a97e88e0', 'cancelled', now() - interval '1 hour'),
  ('ORD-OWN', '00000000-0000-0000-0000-0000000000e1', '295046a4-aea0-4eb4-a069-85a68cc30cb3', 'new', now() - interval '1 hour'),
  ('ORD-PHONE2', '00000000-0000-0000-0000-0000000000f1', '1484a421-bd24-4378-b272-0794a97e88e0', 'new', now() - interval '2 hours'),
  ('ORD-FMT-PRIOR', '00000000-0000-0000-0000-0000000000f5', '1484a421-bd24-4378-b272-0794a97e88e0', 'new', now() - interval '1 hour');

CREATE TEMP TABLE cross_expect AS
SELECT
  (now() - o.created_at) > interval '24 hours' AS older_than_24h,
  (now() - o.created_at) <= interval '7 days' AS within_7d,
  date_trunc('month', timezone('Africa/Cairo', o.created_at))
    <> date_trunc('month', timezone('Africa/Cairo', now())) AS prev_month
FROM public.orders o WHERE o.order_number = 'ORD-CROSS';

SELECT pg_temp.as_user('295046a4-aea0-4eb4-a069-85a68cc30cb3');

-- ===== BEFORE: production definitions =====
SELECT pg_temp.ok((SELECT prev_month FROM cross_expect), 'before: ORD-CROSS is a previous Cairo month');

SELECT pg_temp.ok(
  (SELECT count(*) FROM public.find_duplicate_order_candidates(
     '00000000-0000-0000-0000-0000000000a2', 'نور احمد', '01062175516', NULL, NULL, NULL, '[]'::jsonb
   ) c WHERE c.order_number = 'ORD-CROSS')
  = CASE WHEN (SELECT NOT older_than_24h FROM cross_expect) THEN 1 ELSE 0 END,
  'before: cross-month order is a candidate only inside 24h');

SELECT pg_temp.ok(
  NOT public.customer_has_other_order_this_month(
    '00000000-0000-0000-0000-0000000000a2', '295046a4-aea0-4eb4-a069-85a68cc30cb3'),
  'before: customer_has_other_order_this_month is month-only, so the previous month is false');

-- Exact phone text differs (+20 / spaces) from ORD-FMT-PRIOR's 01062170000.
-- Old notifier compares customers.phone only, so this insert does not notify.
INSERT INTO public.orders (order_number, customer_id, created_by, status, created_at)
VALUES ('ORD-FMT-OLD', '00000000-0000-0000-0000-0000000000f2', '295046a4-aea0-4eb4-a069-85a68cc30cb3', 'new', now());
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.notifications WHERE order_id = (SELECT id FROM public.orders WHERE order_number = 'ORD-FMT-OLD')) = 0,
  'before: +20 phone vs 01… exact text does not notify');

-- ===== AFTER the migration =====
\ir ../migrations/20261102220000_duplicate_order_rolling_7d.sql

SELECT pg_temp.ok(
  pg_get_functiondef('public.find_duplicate_order_candidates(uuid,text,text,text,text,text,jsonb)'::regprocedure) LIKE '%interval ''7 days''%'
  AND pg_get_functiondef('public.find_duplicate_order_candidates(uuid,text,text,text,text,text,jsonb)'::regprocedure) NOT LIKE '%24 hours%'
  AND pg_get_functiondef('public.find_own_repeat_order_candidates(uuid,text,text,text,text,text,jsonb)'::regprocedure) LIKE '%interval ''7 days''%'
  AND pg_get_functiondef('public.customer_has_other_order_this_month(uuid,uuid)'::regprocedure) LIKE '%interval ''7 days''%'
  AND pg_get_functiondef('public.notify_duplicate_customer_order_monthly()'::regprocedure) LIKE '%normalize_phone_eg(c.phone2)%',
  'after: definitions use 7 days and normalized phone2');

SELECT pg_temp.ok(
  (SELECT count(*) FROM public.find_duplicate_order_candidates(
     '00000000-0000-0000-0000-0000000000a2', 'نور احمد', '01062175516', NULL, NULL, NULL, '[]'::jsonb
   ) c WHERE c.order_number = 'ORD-CROSS' AND c.similarity_score = 100 AND c.matched_on_phone)
  = CASE WHEN (SELECT within_7d FROM cross_expect) THEN 1 ELSE 0 END,
  'after: cross-month order is a phone-100 candidate iff it is inside 7 days');

SELECT pg_temp.ok(
  public.customer_has_other_order_this_month(
    '00000000-0000-0000-0000-0000000000a2', '295046a4-aea0-4eb4-a069-85a68cc30cb3')
  = (SELECT within_7d FROM cross_expect),
  'after: customer_has_other_order_this_month follows the 7-day window across months');

-- Same moderator is not a cross-moderator duplicate, including inside the new window.
SELECT pg_temp.ok(
  NOT public.customer_has_other_order_this_month(
    '00000000-0000-0000-0000-0000000000a1', '1484a421-bd24-4378-b272-0794a97e88e0'),
  'after: same creator is not customer_has_other_order_this_month');

SELECT pg_temp.ok(
  (SELECT count(*) FROM public.find_duplicate_order_candidates(
     '00000000-0000-0000-0000-0000000000b1', 'عميل حديث', '01000000011', NULL, NULL, NULL, '[]'::jsonb
   ) c WHERE c.order_number = 'ORD-RECENT' AND c.similarity_score = 100) = 1,
  'after: order 1h ago, other moderator, score 100');

SELECT pg_temp.ok(
  (SELECT count(*) FROM public.find_duplicate_order_candidates(
     '00000000-0000-0000-0000-0000000000c1', 'عميل قديم', '01000000022', NULL, NULL, NULL, '[]'::jsonb
   )) = 0,
  'after: 10 days before the Cairo month is outside 7 days and outside this month');

SELECT pg_temp.ok(
  (SELECT count(*) FROM public.find_duplicate_order_candidates(
     '00000000-0000-0000-0000-0000000000d1', 'عميل ملغي', '01000000033', NULL, NULL, NULL, '[]'::jsonb
   )) = 0,
  'after: cancelled orders are ignored');

SELECT pg_temp.ok(
  (SELECT count(*) FROM public.find_duplicate_order_candidates(
     '00000000-0000-0000-0000-0000000000e1', 'عميل نفس المودريتور', '01000000044', NULL, NULL, NULL, '[]'::jsonb
   )) = 0,
  'after: own order is not a cross-moderator candidate');

SELECT pg_temp.as_user('295046a4-aea0-4eb4-a069-85a68cc30cb3');
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.find_own_repeat_order_candidates(
     '00000000-0000-0000-0000-0000000000e1', 'عميل نفس المودريتور', '01000000044', NULL, NULL, NULL, '[]'::jsonb
   ) c WHERE c.order_number = 'ORD-OWN' AND c.similarity_score = 100) = 1,
  'after: own repeat still warns inside the window');

-- phone2 + Arabic digits on the earlier customer, ASCII phone on the check.
SELECT pg_temp.as_user('295046a4-aea0-4eb4-a069-85a68cc30cb3');
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.find_duplicate_order_candidates(
     '00000000-0000-0000-0000-0000000000f2', 'اسم', '01055556677', NULL, NULL, NULL, '[]'::jsonb
   ) c WHERE c.order_number = 'ORD-PHONE2' AND c.similarity_score = 100 AND c.matched_on_phone) = 1,
  'after: phone2 Arabic digits match normalize_phone_eg');

-- Notifier: normalized phone and phone2. The new text is not an exact match.
INSERT INTO public.customers (id, name, phone) VALUES
  ('00000000-0000-0000-0000-0000000000f3', 'عميل تنسيق ٢', '0106 217 0000');
INSERT INTO public.orders (id, order_number, customer_id, created_by, status, created_at)
VALUES ('00000000-0000-0000-0000-00000000f301', 'ORD-FMT-NEW',
        '00000000-0000-0000-0000-0000000000f3', '295046a4-aea0-4eb4-a069-85a68cc30cb3', 'new', now());
SELECT pg_temp.ok(
  EXISTS (SELECT 1 FROM public.notifications n
          WHERE n.order_id = '00000000-0000-0000-0000-00000000f301'
            AND n.type = 'duplicate_customer_month'
            AND n.description LIKE '%7 أيام%'),
  'after: spaced 01… vs stored 01… normalized phones notify');

-- Same phone as ORD-CROSS. Notifies only when that order is inside 7 days.
INSERT INTO public.customers (id, name, phone) VALUES
  ('00000000-0000-0000-0000-0000000000a3', 'نور احمد ٣', '01062175516');
INSERT INTO public.orders (id, order_number, customer_id, created_by, status, created_at)
VALUES ('00000000-0000-0000-0000-00000000a301', 'ORD-CROSS-NEW',
        '00000000-0000-0000-0000-0000000000a3', '295046a4-aea0-4eb4-a069-85a68cc30cb3', 'new', now());
SELECT pg_temp.ok(
  EXISTS (SELECT 1 FROM public.notifications WHERE order_id = '00000000-0000-0000-0000-00000000a301')
    = (SELECT within_7d FROM cross_expect),
  'after: cross-month pair notifies iff the earlier order is inside 7 days');

-- phone2-only earlier customer. Prior order is ORD-PHONE2 (Arabic phone2).
INSERT INTO public.customers (id, name, phone) VALUES
  ('00000000-0000-0000-0000-0000000000f4', 'عميل هاتف ٢ جديد', '01055556677');
INSERT INTO public.orders (id, order_number, customer_id, created_by, status, created_at)
VALUES ('00000000-0000-0000-0000-00000000f401', 'ORD-PHONE2-NEW',
        '00000000-0000-0000-0000-0000000000f4', '1484a421-bd24-4378-b272-0794a97e88e0', 'new', now());
SELECT pg_temp.ok(
  EXISTS (SELECT 1 FROM public.notifications WHERE order_id = '00000000-0000-0000-0000-00000000f401'),
  'after: phone2 on the earlier customer notifies');

-- Outside both windows: no notification. Same creator still counts (unchanged).
INSERT INTO public.customers (id, name, phone) VALUES
  ('00000000-0000-0000-0000-0000000000c2', 'عميل قديم ٢', '01000000022');
INSERT INTO public.orders (id, order_number, customer_id, created_by, status, created_at)
VALUES ('00000000-0000-0000-0000-00000000c201', 'ORD-OLD-NEW',
        '00000000-0000-0000-0000-0000000000c2', '1484a421-bd24-4378-b272-0794a97e88e0', 'new', now());
SELECT pg_temp.ok(
  NOT EXISTS (SELECT 1 FROM public.notifications WHERE order_id = '00000000-0000-0000-0000-00000000c201'),
  'after: order older than 7 days and in the previous month does not notify');

-- Cancelled earlier orders still count for the notifier (that filter was not added).
INSERT INTO public.customers (id, name, phone) VALUES
  ('00000000-0000-0000-0000-0000000000d2', 'عميل ملغي ٢', '01000000033');
INSERT INTO public.orders (id, order_number, customer_id, created_by, status, created_at)
VALUES ('00000000-0000-0000-0000-00000000d201', 'ORD-CANCEL-NEW',
        '00000000-0000-0000-0000-0000000000d2', '295046a4-aea0-4eb4-a069-85a68cc30cb3', 'new', now());
SELECT pg_temp.ok(
  EXISTS (SELECT 1 FROM public.notifications WHERE order_id = '00000000-0000-0000-0000-00000000d201'),
  'after: notifier still counts a cancelled earlier order');

-- Not a sales moderator → no notification.
INSERT INTO public.customers (id, name, phone) VALUES
  ('00000000-0000-0000-0000-0000000000b2', 'عميل حديث ٢', '01000000011');
INSERT INTO public.orders (id, order_number, customer_id, created_by, status, created_at)
VALUES ('00000000-0000-0000-0000-00000000b201', 'ORD-NOT-MOD',
        '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000099', 'new', now());
SELECT pg_temp.ok(
  NOT EXISTS (SELECT 1 FROM public.notifications WHERE order_id = '00000000-0000-0000-0000-00000000b201'),
  'after: non-moderator insert does not notify');

-- Grants match production: anon may execute the cross-moderator helper, not the own-repeat helper.
SELECT pg_temp.ok(
  has_function_privilege('anon', 'public.find_duplicate_order_candidates(uuid,text,text,text,text,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.customer_has_other_order_this_month(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.notify_duplicate_customer_order_monthly()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.find_own_repeat_order_candidates(uuid,text,text,text,text,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.find_own_repeat_order_candidates(uuid,text,text,text,text,text,jsonb)', 'EXECUTE'),
  'after: grants match coceg-prod');

-- Idempotent second apply.
\ir ../migrations/20261102220000_duplicate_order_rolling_7d.sql
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.find_duplicate_order_candidates(
     '00000000-0000-0000-0000-0000000000b1', 'عميل حديث', '01000000011', NULL, NULL, NULL, '[]'::jsonb
   ) c WHERE c.order_number = 'ORD-RECENT') = 1,
  'second apply still finds the recent order');

ROLLBACK;
