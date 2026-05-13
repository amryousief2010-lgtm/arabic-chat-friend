
-- Tighten notifications: moderators see only notifications tied to their own orders
DROP POLICY IF EXISTS "Moderators and shipping can view notifications" ON public.notifications;

CREATE POLICY "Moderators view notifications for their own orders"
ON public.notifications FOR SELECT
USING (
  has_role(auth.uid(), 'sales_moderator'::app_role)
  AND order_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = notifications.order_id AND o.created_by = auth.uid()
  )
);

CREATE POLICY "Shipping company can view notifications"
ON public.notifications FOR SELECT
USING (has_role(auth.uid(), 'shipping_company'::app_role));

-- Tighten payroll bonus overrides: moderators see only their own row
DROP POLICY IF EXISTS "Authenticated can view payroll overrides" ON public.payroll_bonus_overrides;

CREATE POLICY "Managers view all payroll overrides"
ON public.payroll_bonus_overrides FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]));

CREATE POLICY "Moderators view their own payroll override"
ON public.payroll_bonus_overrides FOR SELECT
USING (
  has_role(auth.uid(), 'sales_moderator'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.full_name = payroll_bonus_overrides.moderator_name
  )
);
