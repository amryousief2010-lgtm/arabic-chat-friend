DROP POLICY IF EXISTS "view private delivery pricing" ON public.private_delivery_pricing;
CREATE POLICY "view private delivery pricing"
ON public.private_delivery_pricing
FOR SELECT
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'marketing_sales_manager'::app_role, 'private_delivery_rep'::app_role, 'sales_moderator'::app_role]));