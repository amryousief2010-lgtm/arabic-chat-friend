ALTER TABLE public.hr_employees ADD COLUMN IF NOT EXISTS photo_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='GM can upload employee photos'
  ) THEN
    CREATE POLICY "GM can upload employee photos"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = 'hr' AND public.has_role(auth.uid(), 'general_manager'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='GM can update employee photos'
  ) THEN
    CREATE POLICY "GM can update employee photos"
      ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = 'hr' AND public.has_role(auth.uid(), 'general_manager'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='GM can delete employee photos'
  ) THEN
    CREATE POLICY "GM can delete employee photos"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = 'hr' AND public.has_role(auth.uid(), 'general_manager'));
  END IF;
END $$;