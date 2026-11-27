-- Lovable Security: "Users can update their own profile" lacked WITH CHECK.
-- WITH CHECK only pins row identity (id stays the caller). It cannot freeze OLD vs NEW
-- columns. trg_profiles_guard_identity_fields remains the source of truth for
-- full_name / shipping_company_name / email / avatar_url.
-- No data rewrite.

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);
