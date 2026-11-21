-- بوابة «إدارة المحادثات»: استثناء على مستوى المستخدم (بموافقة م. عمرو 2026-11-03).
-- الوضع العام يبقى general_manager_only؛ المسموح: المدير العام + من في cm_feature_gate_allowlist فقط.
-- صلاحيات المستخدم المستثنى داخل القسم تأتي من أدواره الحالية (sales_manager ⇒ cm_can_manage / cm_can_read_all).
-- Rollback: DELETE FROM cm_feature_gate_allowlist؛ أو أعد تعريف cm_gate_allows كما في 20261025170000 ثم DROP TABLE.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cm_feature_gate_allowlist (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cm_feature_gate_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cm_feature_gate_allowlist FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cm_feature_gate_allowlist TO authenticated;
DROP POLICY IF EXISTS cm_gate_allowlist_gm ON public.cm_feature_gate_allowlist;
CREATE POLICY cm_gate_allowlist_gm ON public.cm_feature_gate_allowlist FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[]));

INSERT INTO public.cm_feature_gate_allowlist (user_id, note)
VALUES ('77b71c5f-cfa8-42bc-85de-ae536a3ec1c1', 'م. آلاء حامد — كل الخطوط والمحادثات، قراءة ورد وإدارة (موافقة م. عمرو 2026-11-03)')
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cm_gate_allows()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (auth.uid() IS NULL
          AND coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role')
              NOT IN ('anon','authenticated'))
      OR coalesce((SELECT access_mode FROM public.cm_feature_gate WHERE id), 'general_manager_only') = 'roles'
      OR public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[])
      OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.cm_feature_gate_allowlist a WHERE a.user_id = auth.uid()))
$$;
REVOKE ALL ON FUNCTION public.cm_gate_allows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_gate_allows() TO authenticated, service_role;

COMMIT;
