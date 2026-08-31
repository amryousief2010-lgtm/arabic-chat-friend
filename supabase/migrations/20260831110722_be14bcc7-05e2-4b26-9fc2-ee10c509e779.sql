create or replace function public.profiles_guard_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service role / internal jobs
  end if;
  if public.has_any_role(auth.uid(), array['general_manager'::app_role,'executive_manager'::app_role]) then
    return new;
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

drop trigger if exists trg_profiles_guard_identity_fields on public.profiles;
create trigger trg_profiles_guard_identity_fields
before update on public.profiles
for each row execute function public.profiles_guard_identity_fields();