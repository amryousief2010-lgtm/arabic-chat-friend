-- Compare visible rows before and after the RLS initplan rewrite.
-- Edit the user-id list, run the script, and keep the result. Re-run after
-- applying 20260928000000_rls_perf_initplan.sql and diff the two outputs.
-- The script only reads. It ends with ROLLBACK.
--
-- On live Supabase, auth.uid() reads request.jwt.claims. Both claim styles
-- are set so the same script works against the local prelude too.

BEGIN;

CREATE TEMP TABLE rls_perf_users (user_id uuid);
INSERT INTO rls_perf_users (user_id) VALUES
  ('1484a421-bd24-4378-b272-0794a97e88e0'), -- moderator used in the timing harness
  ('7bda161e-9622-49f0-925f-5d613a6fb6c1'); -- general manager used in the timing harness

CREATE TEMP TABLE rls_perf_out (
  user_id uuid,
  tablename text,
  row_count bigint,
  id_md5 text
);

DO $$
DECLARE
  u uuid;
  c bigint;
  h text;
  t text;
  tables text[] := ARRAY[
    'orders',
    'order_items',
    'customers',
    'notifications',
    'order_offer_instances'
  ];
BEGIN
  FOR u IN SELECT user_id FROM rls_perf_users LOOP
    PERFORM set_config(
      'request.jwt.claims',
      json_build_object('sub', u, 'role', 'authenticated')::text,
      true
    );
    PERFORM set_config('request.jwt.claim.sub', u::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    FOREACH t IN ARRAY tables LOOP
      EXECUTE format(
        'SELECT count(*), md5(coalesce(string_agg(id::text, %L ORDER BY id), %L)) FROM public.%I',
        ',',
        '',
        t
      ) INTO c, h;
      INSERT INTO rls_perf_out (user_id, tablename, row_count, id_md5)
      VALUES (u, t, c, h);
    END LOOP;
    EXECUTE 'RESET ROLE';
  END LOOP;
END $$;

SELECT user_id, tablename, row_count, id_md5
  FROM rls_perf_out
 ORDER BY user_id, tablename;

ROLLBACK;
