
DROP POLICY IF EXISTS "lab_treasury_receipts_read" ON storage.objects;
CREATE POLICY "lab_treasury_receipts_read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'lab-treasury-receipts' AND (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'accountant')
    OR public.has_role(auth.uid(),'financial_manager')
    OR public.has_role(auth.uid(),'lab_treasury_keeper')
    OR owner = auth.uid()
  )
);

DROP POLICY IF EXISTS "lab_treasury_receipts_upload" ON storage.objects;
CREATE POLICY "lab_treasury_receipts_upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'lab-treasury-receipts' AND (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'accountant')
    OR public.has_role(auth.uid(),'financial_manager')
    OR public.has_role(auth.uid(),'lab_treasury_keeper')
  )
);
