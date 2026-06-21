
-- 1) Remove hardcoded UUID from HR deduction helper functions
CREATE OR REPLACE FUNCTION public.can_record_hr_deductions(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('general_manager','executive_manager')
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_view_hr_deductions(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('general_manager','executive_manager','hr_manager','accountant','financial_manager')
  );
$function$;

-- Preserve access for the primary admin account that previously relied on the hardcoded UUID
INSERT INTO public.user_roles (user_id, role)
VALUES ('d1d37093-182a-4ee9-932c-d2a2b45f33ec','general_manager')
ON CONFLICT (user_id, role) DO NOTHING;

-- 2) hr_audit_log INSERT: restrict to HR/GM/EM and require performed_by = auth.uid()
DROP POLICY IF EXISTS "hr_audit_insert_authenticated" ON public.hr_audit_log;
CREATE POLICY "hr_audit_insert_managers"
  ON public.hr_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    performed_by = auth.uid()
    AND public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','hr_manager']::app_role[])
  );

-- 3) Storage UPDATE/DELETE policies for slaughter-custody-receipts
CREATE POLICY "custody_receipts_update"
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'slaughter-custody-receipts'
    AND public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','slaughterhouse_custody_keeper','slaughterhouse_manager']::app_role[])
  )
  WITH CHECK (
    bucket_id = 'slaughter-custody-receipts'
    AND public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','slaughterhouse_custody_keeper','slaughterhouse_manager']::app_role[])
  );

CREATE POLICY "custody_receipts_delete"
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'slaughter-custody-receipts'
    AND public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','slaughterhouse_custody_keeper','slaughterhouse_manager']::app_role[])
  );

-- 4) Storage UPDATE/DELETE policies for lab-treasury-receipts
CREATE POLICY "lab_treasury_receipts_update"
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'lab-treasury-receipts'
    AND public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','lab_treasury_keeper','lab_treasury_approver']::app_role[])
  )
  WITH CHECK (
    bucket_id = 'lab-treasury-receipts'
    AND public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','lab_treasury_keeper','lab_treasury_approver']::app_role[])
  );

CREATE POLICY "lab_treasury_receipts_delete"
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'lab-treasury-receipts'
    AND public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','lab_treasury_keeper','lab_treasury_approver']::app_role[])
  );

-- 5) Set search_path on 5 functions
CREATE OR REPLACE FUNCTION public.hr_map_source_status(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN p IN ('approved','posted','completed','settled','active','open') THEN 'approved'
    WHEN p IN ('rejected','cancelled','canceled','reversed','void') THEN 'rejected'
    ELSE 'pending' END
$function$;

CREATE OR REPLACE FUNCTION public.hr_norm_name(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT regexp_replace(
    translate(coalesce(trim(p),''),
      'إأآا ىيؤئة',
      'اااا يي وءه'),
    '\s+', ' ', 'g'
  )
$function$;

CREATE OR REPLACE FUNCTION public.hr_text_is_advance(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT coalesce(p,'') ~* '(سلفة|سلف|advance)'
$function$;

CREATE OR REPLACE FUNCTION public.touch_hic_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END $function$;

CREATE OR REPLACE FUNCTION public.trg_feed_inv_exp_updated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END $function$;
