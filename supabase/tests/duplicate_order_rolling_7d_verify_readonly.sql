-- Read-only check for the missed pair. Creates nothing.
-- Run against coceg-prod (or a copy). Both flags are computed from the rows;
-- this does not call the updated functions, so it is valid before and after deploy.
--
-- Observed 2026-11-02:
--   ORD-20261028-141017  2026-10-28 13:43:20+00  (Cairo 16:43)  delivered
--   ORD-20261101-680523  2026-11-01 13:41:57+00  (Cairo 15:41)  pending
--   gap 3 days 23:58:37, different creators, phone 01062175516 on both,
--   different Cairo months. would_flag_before = false, would_flag_after = true.

WITH pair AS (
  SELECT o.order_number, o.created_at, o.status, o.created_by,
         c.phone, c.phone2,
         public.normalize_phone_eg(c.phone) AS p1,
         public.normalize_phone_eg(c.phone2) AS p2
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.order_number IN ('ORD-20261028-141017', 'ORD-20261101-680523')
),
a AS (SELECT * FROM pair WHERE order_number = 'ORD-20261028-141017'),
b AS (SELECT * FROM pair WHERE order_number = 'ORD-20261101-680523')
SELECT
  a.order_number AS earlier_order,
  b.order_number AS later_order,
  a.created_at AS earlier_at,
  b.created_at AS later_at,
  (b.created_at - a.created_at) AS gap,
  a.created_by IS DISTINCT FROM b.created_by AS different_creator,
  COALESCE(a.status, '') <> 'cancelled' AND COALESCE(b.status, '') <> 'cancelled' AS both_not_cancelled,
  (a.created_at >= b.created_at - interval '24 hours') AS old_within_24h_of_later,
  (date_trunc('month', timezone('Africa/Cairo', a.created_at))
     = date_trunc('month', timezone('Africa/Cairo', b.created_at))) AS same_cairo_month,
  (a.created_at >= b.created_at - interval '7 days') AS new_within_7d_of_later,
  (
    (NULLIF(b.p1, '') IS NOT NULL AND (a.p1 = b.p1 OR a.p2 = b.p1))
    OR (NULLIF(b.p2, '') IS NOT NULL AND (a.p1 = b.p2 OR a.p2 = b.p2))
  ) AS normalized_phone_match,
  (
    COALESCE(a.status, '') <> 'cancelled'
    AND a.created_by IS DISTINCT FROM b.created_by
    AND (
      (NULLIF(b.p1, '') IS NOT NULL AND (a.p1 = b.p1 OR a.p2 = b.p1))
      OR (NULLIF(b.p2, '') IS NOT NULL AND (a.p1 = b.p2 OR a.p2 = b.p2))
    )
    AND (
      a.created_at >= b.created_at - interval '24 hours'
      OR date_trunc('month', timezone('Africa/Cairo', a.created_at))
         = date_trunc('month', timezone('Africa/Cairo', b.created_at))
    )
  ) AS would_flag_before,
  (
    COALESCE(a.status, '') <> 'cancelled'
    AND a.created_by IS DISTINCT FROM b.created_by
    AND (
      (NULLIF(b.p1, '') IS NOT NULL AND (a.p1 = b.p1 OR a.p2 = b.p1))
      OR (NULLIF(b.p2, '') IS NOT NULL AND (a.p1 = b.p2 OR a.p2 = b.p2))
    )
    AND (
      a.created_at >= b.created_at - interval '7 days'
      OR date_trunc('month', timezone('Africa/Cairo', a.created_at))
         = date_trunc('month', timezone('Africa/Cairo', b.created_at))
    )
  ) AS would_flag_after
FROM a
CROSS JOIN b;
