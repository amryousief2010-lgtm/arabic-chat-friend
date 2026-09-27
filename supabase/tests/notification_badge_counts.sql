-- Equivalence: the badge RPC matches the four client count predicates.
-- Inserts are rolled back. Triggers are skipped so the fixture does not fan out.

BEGIN;
SET LOCAL session_replication_role = replica;

-- type is NOT NULL in migrations, so the null-type urgent bucket stays at 0 here.
-- The comparison below still checks that bucket against the same predicate.
INSERT INTO public.notifications (title, description, type, is_read, order_id, target_user_id) VALUES
  ('u1', 'd', 'farm_shipment', false, NULL, '00000000-0000-0000-0000-0000000000a1'),
  ('u2', 'd', 'farm_shipment_receipt', false, NULL, '00000000-0000-0000-0000-0000000000a1'),
  ('u3', 'd', 'new_order', false, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1'),
  ('u5', 'd', 'low_stock', false, '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1'),
  ('u6', 'd', 'production_needed', false, NULL, '00000000-0000-0000-0000-0000000000a1'),
  ('read', 'd', 'new_order', true, '00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a1');

DO $$
DECLARE
  rpc_unread bigint;
  rpc_always bigint;
  rpc_typed bigint;
  rpc_null_type bigint;
  direct_unread bigint;
  direct_always bigint;
  direct_typed bigint;
  direct_null_type bigint;
BEGIN
  SELECT unread_count, always_urgent_count, order_urgent_typed_count, order_urgent_null_type_count
  INTO rpc_unread, rpc_always, rpc_typed, rpc_null_type
  FROM public.get_notification_badge_counts();

  SELECT
    count(*) FILTER (WHERE is_read = false)::bigint,
    count(*) FILTER (WHERE is_read = false AND type IN ('farm_shipment', 'farm_shipment_receipt'))::bigint,
    count(*) FILTER (
      WHERE is_read = false
        AND order_id IS NOT NULL
        AND type IS NOT NULL
        AND type NOT IN ('low_stock', 'production_needed', 'farm_shipment', 'farm_shipment_receipt')
    )::bigint,
    count(*) FILTER (WHERE is_read = false AND order_id IS NOT NULL AND type IS NULL)::bigint
  INTO direct_unread, direct_always, direct_typed, direct_null_type
  FROM public.notifications;

  IF rpc_unread IS DISTINCT FROM direct_unread
     OR rpc_always IS DISTINCT FROM direct_always
     OR rpc_typed IS DISTINCT FROM direct_typed
     OR rpc_null_type IS DISTINCT FROM direct_null_type
  THEN
    RAISE EXCEPTION 'badge rpc (%, %, %, %) <> direct (%, %, %, %)',
      rpc_unread, rpc_always, rpc_typed, rpc_null_type,
      direct_unread, direct_always, direct_typed, direct_null_type;
  END IF;

  IF rpc_always < 2 OR rpc_typed < 1 THEN
    RAISE EXCEPTION 'fixture rows were not counted: % % % %',
      rpc_unread, rpc_always, rpc_typed, rpc_null_type;
  END IF;
END $$;

ROLLBACK;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_notification_badge_counts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute get_notification_badge_counts';
  END IF;
  IF has_function_privilege('public', 'public.get_notification_badge_counts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can execute get_notification_badge_counts';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_notification_badge_counts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute get_notification_badge_counts';
  END IF;
END $$;
