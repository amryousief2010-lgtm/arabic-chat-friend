
CREATE POLICY "mt_attach_read" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'main-treasury-attachments' AND (
      public.has_role(auth.uid(),'main_treasury_accountant')
      OR public.has_role(auth.uid(),'main_treasury_approver')
      OR public.has_role(auth.uid(),'general_manager')
      OR public.has_role(auth.uid(),'executive_manager')
      OR public.has_role(auth.uid(),'financial_manager')
    )
  );

CREATE POLICY "mt_attach_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'main-treasury-attachments' AND (
      public.has_role(auth.uid(),'main_treasury_accountant')
      OR public.has_role(auth.uid(),'main_treasury_approver')
      OR public.has_role(auth.uid(),'general_manager')
      OR public.has_role(auth.uid(),'executive_manager')
      OR public.has_role(auth.uid(),'financial_manager')
    )
  );
