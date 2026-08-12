CREATE INDEX IF NOT EXISTS idx_notifications_order_id ON public.notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_notifications_target_user ON public.notifications(target_user_id);

DROP POLICY IF EXISTS "Managers can view all notifications" ON public.notifications;
CREATE POLICY "Managers can view all notifications" ON public.notifications FOR SELECT TO authenticated
USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['general_manager','executive_manager','sales_manager','marketing_sales_manager','accountant','warehouse_supervisor']::app_role[])));

DROP POLICY IF EXISTS "Moderators view notifications for their own orders" ON public.notifications;
CREATE POLICY "Moderators view notifications for their own orders" ON public.notifications FOR SELECT TO authenticated
USING (
  (SELECT public.has_role((SELECT auth.uid()), 'sales_moderator'::app_role))
  AND order_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = notifications.order_id AND o.created_by = (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "Private rep can view notifications for own delivery orders" ON public.notifications;
CREATE POLICY "Private rep can view notifications for own delivery orders" ON public.notifications FOR SELECT TO authenticated
USING (
  (SELECT public.has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role))
  AND order_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = notifications.order_id AND o.shipping_company = 'مندوب خاص')
);

DROP POLICY IF EXISTS "Private rep can view own targeted notifications" ON public.notifications;
CREATE POLICY "Private rep can view own targeted notifications" ON public.notifications FOR SELECT TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role)) AND target_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Shipping company can view notifications" ON public.notifications;
CREATE POLICY "Shipping company can view notifications" ON public.notifications FOR SELECT TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'shipping_company'::app_role)));

DROP POLICY IF EXISTS "Users view their targeted notifications" ON public.notifications;
CREATE POLICY "Users view their targeted notifications" ON public.notifications FOR SELECT TO authenticated
USING (target_user_id = (SELECT auth.uid()));