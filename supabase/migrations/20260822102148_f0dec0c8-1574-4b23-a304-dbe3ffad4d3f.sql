
DROP POLICY IF EXISTS smm_daily_insert_own ON public.social_media_daily_reports;
CREATE POLICY smm_daily_insert_own ON public.social_media_daily_reports
FOR INSERT TO authenticated
WITH CHECK (
  employee_id = auth.uid()
  AND (public.is_social_media_manager(auth.uid()) OR public.is_social_media_reviewer(auth.uid()))
);

DROP POLICY IF EXISTS smm_daily_select_own ON public.social_media_daily_reports;
CREATE POLICY smm_daily_select_own ON public.social_media_daily_reports
FOR SELECT TO authenticated
USING (
  employee_id = auth.uid()
  AND (public.is_social_media_manager(auth.uid()) OR public.is_social_media_reviewer(auth.uid()))
);

DROP POLICY IF EXISTS smm_daily_update_own_not_reviewed ON public.social_media_daily_reports;
CREATE POLICY smm_daily_update_own_not_reviewed ON public.social_media_daily_reports
FOR UPDATE TO authenticated
USING (
  employee_id = auth.uid() AND status <> 'reviewed'
  AND (public.is_social_media_manager(auth.uid()) OR public.is_social_media_reviewer(auth.uid()))
)
WITH CHECK (
  employee_id = auth.uid()
  AND (public.is_social_media_manager(auth.uid()) OR public.is_social_media_reviewer(auth.uid()))
);

DROP POLICY IF EXISTS smm_weekly_insert_own ON public.social_media_weekly_reports;
CREATE POLICY smm_weekly_insert_own ON public.social_media_weekly_reports
FOR INSERT TO authenticated
WITH CHECK (
  employee_id = auth.uid()
  AND (public.is_social_media_manager(auth.uid()) OR public.is_social_media_reviewer(auth.uid()))
);

DROP POLICY IF EXISTS smm_weekly_select_own ON public.social_media_weekly_reports;
CREATE POLICY smm_weekly_select_own ON public.social_media_weekly_reports
FOR SELECT TO authenticated
USING (
  employee_id = auth.uid()
  AND (public.is_social_media_manager(auth.uid()) OR public.is_social_media_reviewer(auth.uid()))
);

DROP POLICY IF EXISTS smm_weekly_update_own_not_reviewed ON public.social_media_weekly_reports;
CREATE POLICY smm_weekly_update_own_not_reviewed ON public.social_media_weekly_reports
FOR UPDATE TO authenticated
USING (
  employee_id = auth.uid() AND status <> 'reviewed'
  AND (public.is_social_media_manager(auth.uid()) OR public.is_social_media_reviewer(auth.uid()))
)
WITH CHECK (
  employee_id = auth.uid()
  AND (public.is_social_media_manager(auth.uid()) OR public.is_social_media_reviewer(auth.uid()))
);

DROP POLICY IF EXISTS smm_top_posts_owner_all ON public.social_media_weekly_top_posts;
CREATE POLICY smm_top_posts_owner_all ON public.social_media_weekly_top_posts
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.social_media_weekly_reports wr
  WHERE wr.id = weekly_report_id
    AND (wr.employee_id = auth.uid() OR public.is_social_media_reviewer(auth.uid()))
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.social_media_weekly_reports wr
  WHERE wr.id = weekly_report_id
    AND (wr.employee_id = auth.uid() OR public.is_social_media_reviewer(auth.uid()))
));
