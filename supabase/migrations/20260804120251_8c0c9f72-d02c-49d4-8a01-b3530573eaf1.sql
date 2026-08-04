DROP POLICY IF EXISTS "auth insert link audit" ON public.zodex_bill_link_audit;
CREATE POLICY "auth insert link audit" ON public.zodex_bill_link_audit
FOR INSERT TO authenticated
WITH CHECK (linked_by = auth.uid());