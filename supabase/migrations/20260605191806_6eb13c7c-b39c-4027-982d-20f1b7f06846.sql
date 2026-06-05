
-- External collections: collector sees and inserts only own
DROP POLICY IF EXISTS "lec_select" ON public.lab_treasury_external_collections;
DROP POLICY IF EXISTS "lec_insert" ON public.lab_treasury_external_collections;
DROP POLICY IF EXISTS "lec_update_managers" ON public.lab_treasury_external_collections;

CREATE POLICY "lec_select" ON public.lab_treasury_external_collections FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role) OR
  has_role(auth.uid(),'accountant'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role) OR
  (has_role(auth.uid(),'lab_external_collector'::app_role) AND created_by = auth.uid())
);
CREATE POLICY "lec_insert" ON public.lab_treasury_external_collections FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role) OR
  (has_role(auth.uid(),'lab_external_collector'::app_role) AND created_by = auth.uid())
);
CREATE POLICY "lec_update_managers" ON public.lab_treasury_external_collections FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role)
);

-- External deposits: collector can submit own deposits (for own collections)
DROP POLICY IF EXISTS "led_select" ON public.lab_treasury_external_deposits;
DROP POLICY IF EXISTS "led_insert" ON public.lab_treasury_external_deposits;

CREATE POLICY "led_select" ON public.lab_treasury_external_deposits FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role) OR
  has_role(auth.uid(),'accountant'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role) OR
  (has_role(auth.uid(),'lab_external_collector'::app_role) AND EXISTS (
    SELECT 1 FROM public.lab_treasury_external_collections c
    WHERE c.id = external_collection_id AND c.created_by = auth.uid()
  ))
);
CREATE POLICY "led_insert" ON public.lab_treasury_external_deposits FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role) OR
  (has_role(auth.uid(),'lab_external_collector'::app_role) AND created_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.lab_treasury_external_collections c
    WHERE c.id = external_collection_id AND c.created_by = auth.uid()
  ))
);

-- Movements: approver can approve/update
DROP POLICY IF EXISTS "lab_treasury_update_managers" ON public.lab_treasury_movements;
CREATE POLICY "lab_treasury_update_managers" ON public.lab_treasury_movements FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role)
);

-- Opening balances: approver can update (approve/reject)
DROP POLICY IF EXISTS "lto_update_managers" ON public.lab_treasury_opening_balances;
CREATE POLICY "lto_update_managers" ON public.lab_treasury_opening_balances FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role)
);

-- Movements select: ensure approver can see all
DROP POLICY IF EXISTS "lab_treasury_select" ON public.lab_treasury_movements;
CREATE POLICY "lab_treasury_select" ON public.lab_treasury_movements FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role) OR
  has_role(auth.uid(),'accountant'::app_role) OR
  has_role(auth.uid(),'financial_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_keeper'::app_role) OR
  (created_by = auth.uid())
);

-- Audit log + closures: also visible to approver
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "lab_audit_select" ON public.lab_treasury_audit_log';
EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "lab_audit_select" ON public.lab_treasury_audit_log FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'general_manager'::app_role) OR
  has_role(auth.uid(),'executive_manager'::app_role) OR
  has_role(auth.uid(),'lab_treasury_approver'::app_role) OR
  has_role(auth.uid(),'accountant'::app_role)
);
