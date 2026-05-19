
ALTER TABLE public.correction_requests
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_type text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('correction-attachments', 'correction-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "correction_attachments_upload_own" ON storage.objects;
CREATE POLICY "correction_attachments_upload_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'correction-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "correction_attachments_view_own_or_mgr" ON storage.objects;
CREATE POLICY "correction_attachments_view_own_or_mgr"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'correction-attachments'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
  )
);

DROP POLICY IF EXISTS "correction_attachments_delete_own_or_mgr" ON storage.objects;
CREATE POLICY "correction_attachments_delete_own_or_mgr"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'correction-attachments'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
  )
);
