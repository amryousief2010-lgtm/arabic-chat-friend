CREATE POLICY "Moderators and shipping can view notifications"
ON public.notifications
FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY['sales_moderator'::app_role, 'shipping_company'::app_role])
);