
DROP POLICY IF EXISTS "MWT update" ON public.main_warehouse_treasury_txns;
DROP POLICY IF EXISTS "MWT delete" ON public.main_warehouse_treasury_txns;

CREATE POLICY "MWT update" ON public.main_warehouse_treasury_txns
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
  );

CREATE POLICY "MWT delete" ON public.main_warehouse_treasury_txns
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
  );
