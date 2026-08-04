DROP POLICY IF EXISTS "ima_storage_insert_authenticated" ON storage.objects;
CREATE POLICY "ima_storage_insert_authenticated"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'internal-message-attachments'
  AND owner = auth.uid()
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND public.is_message_participant(((storage.foldername(name))[1])::uuid, auth.uid())
);