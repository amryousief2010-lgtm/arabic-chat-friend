
-- 1) Customers: drop blanket SELECT policy (per-role policies remain)
DROP POLICY IF EXISTS "All authenticated can view customers" ON public.customers;

-- 2) delivery_routes: drop hardcoded-UUID policies and replace with role-only
DROP POLICY IF EXISTS "Kimo or GM can insert delivery routes" ON public.delivery_routes;
DROP POLICY IF EXISTS "Kimo or GM can update delivery routes" ON public.delivery_routes;
DROP POLICY IF EXISTS "Kimo or GM can delete delivery routes" ON public.delivery_routes;

CREATE POLICY "GM can insert delivery routes"
  ON public.delivery_routes FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'general_manager'::app_role));

CREATE POLICY "GM can update delivery routes"
  ON public.delivery_routes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'general_manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'general_manager'::app_role));

CREATE POLICY "GM can delete delivery routes"
  ON public.delivery_routes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'general_manager'::app_role));

-- 3) Audit log INSERTs: require actor = auth.uid()
DROP POLICY IF EXISTS "sl_feed_audit_insert" ON public.slaughterhouse_feed_audit_log;
CREATE POLICY "sl_feed_audit_insert"
  ON public.slaughterhouse_feed_audit_log FOR INSERT TO authenticated
  WITH CHECK (performed_by = auth.uid());

DROP POLICY IF EXISTS "mt_audit_insert" ON public.main_treasury_audit_log;
CREATE POLICY "mt_audit_insert"
  ON public.main_treasury_audit_log FOR INSERT TO authenticated
  WITH CHECK (performed_by = auth.uid());

DROP POLICY IF EXISTS "fipa_insert_system" ON public.feed_internal_payments_audit;
CREATE POLICY "fipa_insert_system"
  ON public.feed_internal_payments_audit FOR INSERT TO authenticated
  WITH CHECK (performed_by = auth.uid());
