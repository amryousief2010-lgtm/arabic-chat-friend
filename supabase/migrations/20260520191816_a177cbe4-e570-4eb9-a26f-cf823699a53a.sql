
-- Add idempotency marker for the half-kg conversion on legacy May Excel imports
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS quantity_conversion_version text;

-- One-time correction: for orders imported from May Excel files only,
-- where the stored quantity is the raw Excel cell value (number of half-kg units),
-- convert to actual kilograms by multiplying by 0.5.
-- Total order value MUST stay unchanged -> we double unit_price so total_price stays the same.
WITH target AS (
  SELECT oi.id
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.order_number ~ '^(AYA|SARA|NORA|MANAL|SHIP)-EXCEL-MAY-'
    AND oi.quantity_conversion_version IS DISTINCT FROM 'half_kg_v1'
    AND TRIM(oi.product_name) IN (
      'لحم قطع','لحم','استيك','موزة','فراشة','قطعية الدبوس','تربيانكو','اسكالوب','رول',
      'كباب','قطع كباب','كبدة','قلب','قوانص','رقاب','كوارع','دهن','شاورما','شيش',
      'كفتة','سجق','برجر','طرب','حواوشي','مفروم','كفتة الرز','كفتة أرز',
      'برجر جبنة','برجر بالجبنة','ممبار','نخاع'
    )
)
UPDATE public.order_items oi
SET quantity   = ROUND((oi.quantity * 0.5)::numeric, 3),
    unit_price = CASE WHEN oi.quantity > 0
                      THEN ROUND((oi.unit_price * 2)::numeric, 4)
                      ELSE oi.unit_price END,
    is_half_kg = CASE WHEN (oi.quantity)::int % 2 = 1 THEN true ELSE oi.is_half_kg END,
    quantity_conversion_version = 'half_kg_v1'
FROM target
WHERE oi.id = target.id;
