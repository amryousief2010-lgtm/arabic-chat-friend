CREATE POLICY "Main treasury approvers can read agouza handovers"
ON public.agouza_warehouse_treasury_txns
FOR SELECT
USING (
  txn_type = 'handover_to_main' AND (
    public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
    OR public.has_role(auth.uid(), 'financial_manager')
    OR public.has_role(auth.uid(), 'main_treasury_approver')
    OR public.has_role(auth.uid(), 'main_treasury_accountant')
  )
);

-- Also allow them to update (approve/reject writes back to this table)
CREATE POLICY "Main treasury approvers can update agouza handovers"
ON public.agouza_warehouse_treasury_txns
FOR UPDATE
USING (
  txn_type = 'handover_to_main' AND (
    public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
    OR public.has_role(auth.uid(), 'financial_manager')
    OR public.has_role(auth.uid(), 'main_treasury_approver')
    OR public.has_role(auth.uid(), 'main_treasury_accountant')
  )
);