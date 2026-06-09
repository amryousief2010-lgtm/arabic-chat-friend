
-- 1) Add the new role to the enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'social_media_manager';

-- 2) Helper function (uses text cast so it works in the same transaction)
CREATE OR REPLACE FUNCTION public.is_social_media_manager(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role::text = 'social_media_manager'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_social_media_reviewer(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role::text IN ('general_manager','executive_manager','marketing_sales_manager')
  )
$$;

-- 3) updated_at trigger function (reuse generic if exists)
CREATE OR REPLACE FUNCTION public.tg_social_media_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 4) Daily reports table
CREATE TABLE public.social_media_daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_name text NOT NULL,
  posts_count integer NOT NULL DEFAULT 0,
  reels_videos_count integer NOT NULL DEFAULT 0,
  interested_customers_count integer NOT NULL DEFAULT 0,
  top_engaging_content text NOT NULL,
  issues_or_complaints text,
  tomorrow_content_suggestions text NOT NULL,
  additional_notes text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted','reviewed')),
  management_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, report_date)
);

GRANT SELECT, INSERT, UPDATE ON public.social_media_daily_reports TO authenticated;
GRANT ALL ON public.social_media_daily_reports TO service_role;
ALTER TABLE public.social_media_daily_reports ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_smdr_updated_at
BEFORE UPDATE ON public.social_media_daily_reports
FOR EACH ROW EXECUTE FUNCTION public.tg_social_media_set_updated_at();

-- SMM: insert own
CREATE POLICY "smm_daily_insert_own"
ON public.social_media_daily_reports FOR INSERT
TO authenticated
WITH CHECK (public.is_social_media_manager(auth.uid()) AND employee_id = auth.uid());

-- SMM: select own
CREATE POLICY "smm_daily_select_own"
ON public.social_media_daily_reports FOR SELECT
TO authenticated
USING (public.is_social_media_manager(auth.uid()) AND employee_id = auth.uid());

-- SMM: update own when not reviewed
CREATE POLICY "smm_daily_update_own_not_reviewed"
ON public.social_media_daily_reports FOR UPDATE
TO authenticated
USING (
  public.is_social_media_manager(auth.uid())
  AND employee_id = auth.uid()
  AND status <> 'reviewed'
)
WITH CHECK (
  public.is_social_media_manager(auth.uid())
  AND employee_id = auth.uid()
);

-- Reviewers: select all
CREATE POLICY "smm_daily_reviewer_select_all"
ON public.social_media_daily_reports FOR SELECT
TO authenticated
USING (public.is_social_media_reviewer(auth.uid()));

-- Reviewers: update (for status/notes)
CREATE POLICY "smm_daily_reviewer_update"
ON public.social_media_daily_reports FOR UPDATE
TO authenticated
USING (public.is_social_media_reviewer(auth.uid()))
WITH CHECK (public.is_social_media_reviewer(auth.uid()));

-- 5) Weekly reports table
CREATE TABLE public.social_media_weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_name text NOT NULL,
  facebook_followers_growth integer NOT NULL DEFAULT 0,
  instagram_followers_growth integer NOT NULL DEFAULT 0,
  tiktok_followers_growth integer NOT NULL DEFAULT 0,
  youtube_followers_growth integer NOT NULL DEFAULT 0,
  leads_count integer NOT NULL DEFAULT 0,
  best_platform text NOT NULL,
  best_platform_reason text NOT NULL,
  repeated_problems text,
  weekly_summary text NOT NULL,
  next_week_suggestions text NOT NULL,
  additional_notes text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted','reviewed')),
  management_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, week_start_date, week_end_date)
);

GRANT SELECT, INSERT, UPDATE ON public.social_media_weekly_reports TO authenticated;
GRANT ALL ON public.social_media_weekly_reports TO service_role;
ALTER TABLE public.social_media_weekly_reports ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_smwr_updated_at
BEFORE UPDATE ON public.social_media_weekly_reports
FOR EACH ROW EXECUTE FUNCTION public.tg_social_media_set_updated_at();

CREATE POLICY "smm_weekly_insert_own"
ON public.social_media_weekly_reports FOR INSERT
TO authenticated
WITH CHECK (public.is_social_media_manager(auth.uid()) AND employee_id = auth.uid());

CREATE POLICY "smm_weekly_select_own"
ON public.social_media_weekly_reports FOR SELECT
TO authenticated
USING (public.is_social_media_manager(auth.uid()) AND employee_id = auth.uid());

CREATE POLICY "smm_weekly_update_own_not_reviewed"
ON public.social_media_weekly_reports FOR UPDATE
TO authenticated
USING (
  public.is_social_media_manager(auth.uid())
  AND employee_id = auth.uid()
  AND status <> 'reviewed'
)
WITH CHECK (
  public.is_social_media_manager(auth.uid())
  AND employee_id = auth.uid()
);

CREATE POLICY "smm_weekly_reviewer_select_all"
ON public.social_media_weekly_reports FOR SELECT
TO authenticated
USING (public.is_social_media_reviewer(auth.uid()));

CREATE POLICY "smm_weekly_reviewer_update"
ON public.social_media_weekly_reports FOR UPDATE
TO authenticated
USING (public.is_social_media_reviewer(auth.uid()))
WITH CHECK (public.is_social_media_reviewer(auth.uid()));

-- 6) Weekly top posts (child)
CREATE TABLE public.social_media_weekly_top_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_report_id uuid NOT NULL REFERENCES public.social_media_weekly_reports(id) ON DELETE CASCADE,
  platform text NOT NULL,
  post_title text NOT NULL,
  post_url text,
  reach_count integer NOT NULL DEFAULT 0,
  engagement_count integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_media_weekly_top_posts TO authenticated;
GRANT ALL ON public.social_media_weekly_top_posts TO service_role;
ALTER TABLE public.social_media_weekly_top_posts ENABLE ROW LEVEL SECURITY;

-- SMM: full CRUD on own weekly posts while parent not reviewed
CREATE POLICY "smm_top_posts_owner_all"
ON public.social_media_weekly_top_posts FOR ALL
TO authenticated
USING (
  public.is_social_media_manager(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.social_media_weekly_reports wr
    WHERE wr.id = weekly_report_id AND wr.employee_id = auth.uid()
      AND wr.status <> 'reviewed'
  )
)
WITH CHECK (
  public.is_social_media_manager(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.social_media_weekly_reports wr
    WHERE wr.id = weekly_report_id AND wr.employee_id = auth.uid()
      AND wr.status <> 'reviewed'
  )
);

-- Reviewers: select all
CREATE POLICY "smm_top_posts_reviewer_select"
ON public.social_media_weekly_top_posts FOR SELECT
TO authenticated
USING (public.is_social_media_reviewer(auth.uid()));

-- 7) Allow social_media_manager to read orders (read-only)
CREATE POLICY "Social media manager can view orders read-only"
ON public.orders FOR SELECT
TO authenticated
USING (public.is_social_media_manager(auth.uid()));

-- Also allow reading order_items for the same role (UI shows products)
CREATE POLICY "Social media manager can view order_items read-only"
ON public.order_items FOR SELECT
TO authenticated
USING (public.is_social_media_manager(auth.uid()));

-- Note: NO insert/update/delete policies are added for orders or order_items
-- for social_media_manager — RLS denies writes by default.
