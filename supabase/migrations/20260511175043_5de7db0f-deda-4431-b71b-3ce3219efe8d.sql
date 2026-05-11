DROP POLICY IF EXISTS "Shipping and managers can update order items" ON public.order_items;
DROP POLICY IF EXISTS "Shipping and managers can delete order items" ON public.order_items;
DROP POLICY IF EXISTS "Shipping company can insert order items" ON public.order_items;

CREATE POLICY "Authorized roles can update order items"
ON public.order_items FOR UPDATE
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role]));

CREATE POLICY "Authorized roles can delete order items"
ON public.order_items FOR DELETE
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role]));

-- Replace existing INSERT policy to also allow shipping_company explicitly via has_any_role
DROP POLICY IF EXISTS "Authenticated users can create order items" ON public.order_items;
CREATE POLICY "Authorized roles can create order items"
ON public.order_items FOR INSERT
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'sales_moderator'::app_role, 'shipping_company'::app_role]));

-- Allow moderators to view ALL order items (so they can see and edit any order)
DROP POLICY IF EXISTS "Sales moderators can view their own order items" ON public.order_items;
CREATE POLICY "Sales moderators can view all order items"
ON public.order_items FOR SELECT
USING (has_role(auth.uid(), 'sales_moderator'::app_role));

-- Allow moderators to update any order (not only their own) so editing items / totals works
DROP POLICY IF EXISTS "Sales moderators can update their own orders" ON public.orders;
CREATE POLICY "Sales moderators can update any order"
ON public.orders FOR UPDATE
USING (has_role(auth.uid(), 'sales_moderator'::app_role))
WITH CHECK (has_role(auth.uid(), 'sales_moderator'::app_role));

-- Allow moderators to view any order
DROP POLICY IF EXISTS "Sales moderators can view their own orders" ON public.orders;
CREATE POLICY "Sales moderators can view all orders"
ON public.orders FOR SELECT
USING (has_role(auth.uid(), 'sales_moderator'::app_role));