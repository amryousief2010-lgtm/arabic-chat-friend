DROP POLICY IF EXISTS "auth read sublocations" ON public.warehouse_sublocations;
DROP POLICY IF EXISTS "auth read sub items" ON public.inventory_sublocation_items;

CREATE POLICY "sublocations read authorized"
ON public.warehouse_sublocations FOR SELECT TO authenticated
USING (
  public.can_post_inventory(auth.uid())
  OR public.has_role(auth.uid(), 'accountant')
  OR public.has_role(auth.uid(), 'financial_manager')
  OR public.has_role(auth.uid(), 'cost_accountant')
  OR public.has_role(auth.uid(), 'quality_manager')
);

CREATE POLICY "inv sub items read authorized"
ON public.inventory_sublocation_items FOR SELECT TO authenticated
USING (
  public.can_post_inventory(auth.uid())
  OR public.has_role(auth.uid(), 'accountant')
  OR public.has_role(auth.uid(), 'financial_manager')
  OR public.has_role(auth.uid(), 'cost_accountant')
  OR public.has_role(auth.uid(), 'quality_manager')
);