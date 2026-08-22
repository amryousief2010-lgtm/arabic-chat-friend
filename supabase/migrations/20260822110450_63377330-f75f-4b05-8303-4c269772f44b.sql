CREATE OR REPLACE FUNCTION public.is_social_media_approver(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role::text IN ('general_manager','executive_manager')
  )
$$;

DROP POLICY IF EXISTS smm_daily_reviewer_update ON public.social_media_daily_reports;
CREATE POLICY smm_daily_approver_update ON public.social_media_daily_reports
FOR UPDATE TO authenticated
USING (public.is_social_media_approver(auth.uid()))
WITH CHECK (public.is_social_media_approver(auth.uid()));

DROP POLICY IF EXISTS smm_daily_reviewer_delete ON public.social_media_daily_reports;
CREATE POLICY smm_daily_approver_delete ON public.social_media_daily_reports
FOR DELETE TO authenticated
USING (public.is_social_media_approver(auth.uid()));

DROP POLICY IF EXISTS smm_weekly_reviewer_update ON public.social_media_weekly_reports;
CREATE POLICY smm_weekly_approver_update ON public.social_media_weekly_reports
FOR UPDATE TO authenticated
USING (public.is_social_media_approver(auth.uid()))
WITH CHECK (public.is_social_media_approver(auth.uid()));

DROP POLICY IF EXISTS smm_weekly_reviewer_delete ON public.social_media_weekly_reports;
CREATE POLICY smm_weekly_approver_delete ON public.social_media_weekly_reports
FOR DELETE TO authenticated
USING (public.is_social_media_approver(auth.uid()));