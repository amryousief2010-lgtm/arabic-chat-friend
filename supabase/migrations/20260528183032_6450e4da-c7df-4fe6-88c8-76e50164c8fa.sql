CREATE POLICY "Agouza keeper can view main pickup orders"
ON public.orders
FOR SELECT
USING (
  has_role(auth.uid(), 'agouza_warehouse_keeper'::app_role)
  AND fulfillment_type = 'pickup'
  AND source_warehouse_id IN (
    SELECT id FROM warehouses WHERE name LIKE '%الرئيسي%' OR name LIKE '%المقر%'
  )
);