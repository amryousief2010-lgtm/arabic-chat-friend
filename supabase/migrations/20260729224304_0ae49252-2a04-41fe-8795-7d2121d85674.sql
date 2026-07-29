DROP POLICY IF EXISTS "auth write sub items" ON public.inventory_sublocation_items;

CREATE POLICY "inv sub items insert authorized"
ON public.inventory_sublocation_items
FOR INSERT TO authenticated
WITH CHECK (public.can_post_inventory(auth.uid()));

CREATE POLICY "inv sub items update authorized"
ON public.inventory_sublocation_items
FOR UPDATE TO authenticated
USING (public.can_post_inventory(auth.uid()))
WITH CHECK (public.can_post_inventory(auth.uid()));

CREATE POLICY "inv sub items delete authorized"
ON public.inventory_sublocation_items
FOR DELETE TO authenticated
USING (public.can_post_inventory(auth.uid()));