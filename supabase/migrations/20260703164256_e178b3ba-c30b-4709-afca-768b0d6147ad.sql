CREATE POLICY mt_attach_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'main-treasury-attachments'
  AND (
    has_role(auth.uid(), 'main_treasury_approver'::app_role)
    OR has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'main-treasury-attachments'
  AND (
    has_role(auth.uid(), 'main_treasury_approver'::app_role)
    OR has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
  )
);

CREATE POLICY mt_attach_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'main-treasury-attachments'
  AND (
    has_role(auth.uid(), 'main_treasury_approver'::app_role)
    OR has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
  )
);