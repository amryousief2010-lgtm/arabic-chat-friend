
DROP VIEW IF EXISTS public.v_feed_factory_distribution;
CREATE VIEW public.v_feed_factory_distribution AS
SELECT
  s.id AS sale_id, s.sale_no, s.sale_date, s.destination_type,
  CASE s.destination_type
    WHEN 'external_customer' THEN COALESCE(s.customer,'عميل خارجي')
    WHEN 'brooding_feed_store' THEN 'حضانات تسمين الكتاكيت'
    WHEN 'slaughterhouse_feed_store' THEN 'مخزن علف المجزر'
  END AS destination_label,
  (s.destination_type <> 'external_customer') AS is_internal_transfer,
  i.id AS item_id, i.feed_product_id, fp.name AS feed_name,
  i.quantity, i.unit_price, i.unit_cost,
  (i.quantity * i.unit_price)::numeric AS line_total,
  (i.quantity * COALESCE(i.unit_cost,0))::numeric AS line_cost,
  s.salesperson, s.notes
FROM feed_sales s
JOIN feed_sale_items i ON i.sale_id = s.id
LEFT JOIN feed_products fp ON fp.id = i.feed_product_id
WHERE i.feed_product_id IS NOT NULL;
GRANT SELECT ON public.v_feed_factory_distribution TO authenticated;
