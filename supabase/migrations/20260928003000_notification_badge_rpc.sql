-- Badge counts in one statement.
--
-- Replaces the four head-count queries in src/hooks/useUnreadNotifications.tsx.
-- SECURITY INVOKER so RLS still decides which rows each role can see.
-- The four numbers are the same predicates as the client:
--   1. is_read = false
--   2. is_read = false AND type IN ('farm_shipment','farm_shipment_receipt')
--   3. is_read = false AND order_id IS NOT NULL AND type IS NOT NULL
--      AND type NOT IN (low_stock, production_needed, farm_shipment, farm_shipment_receipt)
--   4. is_read = false AND order_id IS NOT NULL AND type IS NULL
-- `is_read = false` (not `NOT is_read`) so NULL is_read is excluded, matching PostgREST eq.false.
--
-- Partial index: notifications(target_user_id) WHERE is_read = false.
-- The live table was about 76,049 rows / 66,021 unread when this was written.
-- A disposable local copy is empty (about 144 kB). CREATE INDEX CONCURRENTLY
-- cannot run inside the transaction that applies this file
-- (scripts/apply_migrations.py and hosted Supabase migrations), so the index
-- is created in the migration transaction.

CREATE OR REPLACE FUNCTION public.get_notification_badge_counts()
RETURNS TABLE (
  unread_count bigint,
  always_urgent_count bigint,
  order_urgent_typed_count bigint,
  order_urgent_null_type_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    count(*) FILTER (WHERE n.is_read = false)::bigint,
    count(*) FILTER (
      WHERE n.is_read = false
        AND n.type IN ('farm_shipment', 'farm_shipment_receipt')
    )::bigint,
    count(*) FILTER (
      WHERE n.is_read = false
        AND n.order_id IS NOT NULL
        AND n.type IS NOT NULL
        AND n.type NOT IN (
          'low_stock',
          'production_needed',
          'farm_shipment',
          'farm_shipment_receipt'
        )
    )::bigint,
    count(*) FILTER (
      WHERE n.is_read = false
        AND n.order_id IS NOT NULL
        AND n.type IS NULL
    )::bigint
  FROM public.notifications n;
$$;

REVOKE ALL ON FUNCTION public.get_notification_badge_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_notification_badge_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_notification_badge_counts() TO authenticated;

CREATE INDEX IF NOT EXISTS notifications_unread_target_user_idx
  ON public.notifications (target_user_id)
  WHERE is_read = false AND target_user_id IS NOT NULL;
