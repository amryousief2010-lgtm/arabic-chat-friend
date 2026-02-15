-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Authenticated users can view notifications" ON public.notifications;

-- Create a role-based policy instead
CREATE POLICY "Managers can view all notifications"
ON public.notifications
FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role])
);
