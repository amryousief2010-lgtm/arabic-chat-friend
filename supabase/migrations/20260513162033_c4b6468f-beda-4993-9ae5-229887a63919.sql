-- Restrict sales moderators to only see/update their own orders
DROP POLICY IF EXISTS "Sales moderators can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Sales moderators can update any order" ON public.orders;

CREATE POLICY "Sales moderators can view their own orders"
ON public.orders FOR SELECT
USING (has_role(auth.uid(), 'sales_moderator'::app_role) AND auth.uid() = created_by);

CREATE POLICY "Sales moderators can update their own orders"
ON public.orders FOR UPDATE
USING (has_role(auth.uid(), 'sales_moderator'::app_role) AND auth.uid() = created_by)
WITH CHECK (has_role(auth.uid(), 'sales_moderator'::app_role) AND auth.uid() = created_by);

-- Restrict order_items visibility for moderators to items of their own orders
DROP POLICY IF EXISTS "Sales moderators can view all order items" ON public.order_items;

CREATE POLICY "Sales moderators can view their own order items"
ON public.order_items FOR SELECT
USING (
  has_role(auth.uid(), 'sales_moderator'::app_role)
  AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.created_by = auth.uid())
);