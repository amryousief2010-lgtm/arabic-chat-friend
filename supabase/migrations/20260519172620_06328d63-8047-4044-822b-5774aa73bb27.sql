WITH m AS (
  SELECT o.id, o.customer_id, o.total, o.order_number, o.created_at, c.phone, o.moderator
  FROM orders o JOIN customers c ON c.id=o.customer_id
  WHERE o.moderator IN ('منال','نورا','أية','سارة')
    AND o.created_at >= '2026-05-01' AND o.created_at < '2026-06-01'
),
g AS (
  SELECT phone, total, date_trunc('day',created_at)::date d, moderator,
    unnest((array_agg(id ORDER BY (order_number LIKE 'IMP14-%') DESC, created_at DESC))
           [1:greatest(count(*)-1,0)]) AS del_id
  FROM m GROUP BY 1,2,3,4 HAVING count(*)>1
),
to_del AS (
  SELECT del_id FROM g
  WHERE EXISTS (SELECT 1 FROM orders o2 WHERE o2.id = g.del_id AND o2.order_number LIKE 'IMP14-%')
)
, del_items AS (
  DELETE FROM order_items WHERE order_id IN (SELECT del_id FROM to_del) RETURNING 1
)
DELETE FROM orders WHERE id IN (SELECT del_id FROM to_del);