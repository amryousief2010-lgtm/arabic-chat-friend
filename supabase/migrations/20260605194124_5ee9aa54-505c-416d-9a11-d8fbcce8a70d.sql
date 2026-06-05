
CREATE POLICY "custody_receipts_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'slaughter-custody-receipts'
  AND (
    public.has_role(auth.uid(),'slaughterhouse_custody_keeper'::app_role)
    OR public.is_slaughter_custody_manager(auth.uid())
  )
);

CREATE POLICY "custody_receipts_select" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'slaughter-custody-receipts'
  AND (
    public.is_slaughter_custody_manager(auth.uid())
    OR (public.has_role(auth.uid(),'slaughterhouse_custody_keeper'::app_role) AND owner = auth.uid())
  )
);
