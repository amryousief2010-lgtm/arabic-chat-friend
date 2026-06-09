
CREATE OR REPLACE FUNCTION public.is_social_media_reviewer(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role::text IN ('general_manager','executive_manager','marketing_sales_manager','sales_manager')
  )
$$;

DROP POLICY IF EXISTS smm_daily_reviewer_delete ON public.social_media_daily_reports;
CREATE POLICY smm_daily_reviewer_delete ON public.social_media_daily_reports
  FOR DELETE USING (public.is_social_media_reviewer(auth.uid()));

DROP POLICY IF EXISTS smm_weekly_reviewer_delete ON public.social_media_weekly_reports;
CREATE POLICY smm_weekly_reviewer_delete ON public.social_media_weekly_reports
  FOR DELETE USING (public.is_social_media_reviewer(auth.uid()));

DROP POLICY IF EXISTS smm_top_posts_reviewer_delete ON public.social_media_weekly_top_posts;
CREATE POLICY smm_top_posts_reviewer_delete ON public.social_media_weekly_top_posts
  FOR DELETE USING (public.is_social_media_reviewer(auth.uid()));

GRANT DELETE ON public.social_media_daily_reports TO authenticated;
GRANT DELETE ON public.social_media_weekly_reports TO authenticated;
GRANT DELETE ON public.social_media_weekly_top_posts TO authenticated;

ALTER TABLE public.social_media_daily_reports
  ADD COLUMN IF NOT EXISTS complaint_attachment_path text;

-- Reviewers can also UPDATE all fields (not just notes) — already covered by smm_*_reviewer_update.
-- Storage policies on social-media-attachments bucket
DROP POLICY IF EXISTS smm_attach_owner_insert ON storage.objects;
CREATE POLICY smm_attach_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'social-media-attachments'
    AND public.is_social_media_manager(auth.uid())
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS smm_attach_select ON storage.objects;
CREATE POLICY smm_attach_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'social-media-attachments'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_social_media_reviewer(auth.uid())
    )
  );

DROP POLICY IF EXISTS smm_attach_owner_update ON storage.objects;
CREATE POLICY smm_attach_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'social-media-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS smm_attach_delete ON storage.objects;
CREATE POLICY smm_attach_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'social-media-attachments'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_social_media_reviewer(auth.uid())
    )
  );
