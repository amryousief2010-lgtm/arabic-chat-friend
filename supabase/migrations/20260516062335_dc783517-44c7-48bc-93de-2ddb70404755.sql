CREATE POLICY "Private rep can view notifications for own delivery orders"
ON public.notifications FOR SELECT
USING (
  has_role(auth.uid(), 'private_delivery_rep'::app_role)
  AND order_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = notifications.order_id
      AND o.shipping_company = 'مندوب خاص'
  )
);

CREATE POLICY "Private rep can update notifications for own delivery orders"
ON public.notifications FOR UPDATE
USING (
  has_role(auth.uid(), 'private_delivery_rep'::app_role)
  AND order_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = notifications.order_id
      AND o.shipping_company = 'مندوب خاص'
  )
);