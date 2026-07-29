DROP POLICY IF EXISTS "auth insert sub moves" ON public.sublocation_movements;

CREATE POLICY "sub moves insert authorized"
ON public.sublocation_movements
FOR INSERT TO authenticated
WITH CHECK (public.can_post_inventory(auth.uid()));