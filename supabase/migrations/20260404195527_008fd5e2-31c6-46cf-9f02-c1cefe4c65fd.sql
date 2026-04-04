
-- 1. Fix user_roles: Add WITH CHECK to general_manager ALL policy
DROP POLICY IF EXISTS "General manager can manage roles" ON public.user_roles;
CREATE POLICY "General manager can manage roles"
ON public.user_roles
FOR ALL
TO public
USING (has_role(auth.uid(), 'general_manager'::app_role))
WITH CHECK (has_role(auth.uid(), 'general_manager'::app_role));

-- 2. Fix order_items INSERT: Restrict to users who can create orders
DROP POLICY IF EXISTS "Authenticated users can create order items" ON public.order_items;
CREATE POLICY "Authenticated users can create order items"
ON public.order_items
FOR INSERT
TO authenticated
WITH CHECK (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'sales_manager'::app_role,
    'sales_moderator'::app_role
  ])
);

-- 3. Add explicit DELETE policy on customers (managers only)
CREATE POLICY "Managers can delete customers"
ON public.customers
FOR DELETE
TO public
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role]));
