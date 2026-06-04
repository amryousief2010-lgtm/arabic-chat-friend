-- Convert legacy half-kg rows (quantity = number of half-kg packets, unit_price = per-packet)
-- into the new semantics where quantity is actual kilograms and unit_price is per-kilogram.
-- total_price stays identical, so historical totals are preserved.
UPDATE public.order_items oi
SET quantity   = ROUND((oi.quantity * 0.5)::numeric, 3),
    unit_price = ROUND((oi.unit_price * 2)::numeric, 4),
    quantity_conversion_version = 'half_kg_v2'
WHERE oi.is_half_kg = true
  AND COALESCE(oi.quantity_conversion_version, '') <> 'half_kg_v2';