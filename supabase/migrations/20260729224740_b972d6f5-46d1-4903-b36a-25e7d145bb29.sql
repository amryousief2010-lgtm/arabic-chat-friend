DROP POLICY IF EXISTS "auth write sublocations" ON public.warehouse_sublocations;

CREATE POLICY "sublocations insert authorized"
ON public.warehouse_sublocations
FOR INSERT TO authenticated
WITH CHECK (public.can_post_inventory(auth.uid()));

CREATE POLICY "sublocations update authorized"
ON public.warehouse_sublocations
FOR UPDATE TO authenticated
USING (public.can_post_inventory(auth.uid()))
WITH CHECK (public.can_post_inventory(auth.uid()));

CREATE POLICY "sublocations delete authorized"
ON public.warehouse_sublocations
FOR DELETE TO authenticated
USING (public.can_post_inventory(auth.uid()));