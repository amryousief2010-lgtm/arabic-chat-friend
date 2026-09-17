ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profile_directory ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE OR REPLACE FUNCTION public.sync_profile_directory_from_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.profile_directory WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.profile_directory (id, full_name, avatar_url, updated_at)
  VALUES (NEW.id, NEW.full_name, NEW.avatar_url, now())
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      avatar_url = EXCLUDED.avatar_url,
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_directory_from_profiles ON public.profiles;
CREATE TRIGGER trg_sync_profile_directory_from_profiles
AFTER INSERT OR DELETE OR UPDATE OF full_name, avatar_url ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_directory_from_profiles();

CREATE OR REPLACE FUNCTION public.profiles_guard_identity_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.has_any_role(auth.uid(), array['general_manager'::app_role,'executive_manager'::app_role]) then
    return new;
  end if;
  if new.avatar_url is distinct from old.avatar_url then
    raise exception 'identity_field_change_forbidden: avatar_url';
  end if;
  if new.shipping_company_name is distinct from old.shipping_company_name then
    raise exception 'identity_field_change_forbidden: shipping_company_name';
  end if;
  if new.full_name is distinct from old.full_name then
    raise exception 'identity_field_change_forbidden: full_name';
  end if;
  if new.email is distinct from old.email then
    raise exception 'identity_field_change_forbidden: email';
  end if;
  return new;
end;
$$;

UPDATE public.profile_directory d
SET avatar_url = p.avatar_url
FROM public.profiles p
WHERE p.id = d.id AND d.avatar_url IS DISTINCT FROM p.avatar_url;

CREATE POLICY "Authenticated users can view avatars"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars');

CREATE POLICY "General manager can upload avatars"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND public.has_role(auth.uid(), 'general_manager'::app_role));

CREATE POLICY "General manager can update avatars"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND public.has_role(auth.uid(), 'general_manager'::app_role));

CREATE POLICY "General manager can delete avatars"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'avatars' AND public.has_role(auth.uid(), 'general_manager'::app_role));