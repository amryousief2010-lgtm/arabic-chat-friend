-- Grant accountant role to محمد شعلة (in addition to slaughterhouse_manager)
INSERT INTO public.user_roles (user_id, role)
VALUES ('d1d37093-182a-4ee9-932c-d2a2b45f33ec', 'accountant')
ON CONFLICT (user_id, role) DO NOTHING;

-- Allow accountant to update product cost and price (for cost/profit management)
CREATE POLICY "Accountant can update product costs"
ON public.products
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'accountant'))
WITH CHECK (public.has_role(auth.uid(), 'accountant'));