INSERT INTO public.order_offer_instances (
  order_id,
  offer_box_id,
  offer_name,
  quantity,
  created_by
)
SELECT
  o.id,
  'c3267d54-42a2-41f2-85da-746e07ea4334'::uuid,
  'بوكس 1510',
  2,
  o.created_by
FROM public.orders o
WHERE o.id = '822ec6aa-eaa1-4d5f-9b28-b5f6ff7fac0b'::uuid
  AND o.order_number = 'ORD-20260904-303259'
ON CONFLICT (order_id, offer_name)
DO UPDATE SET
  offer_box_id = EXCLUDED.offer_box_id,
  quantity = EXCLUDED.quantity,
  updated_at = now();