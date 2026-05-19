
-- 1) Delete conflicting accounts (duplicates / collision with existing @coceg.net)
DELETE FROM auth.users WHERE id IN (
  'ac39f12f-daa2-4a4d-8168-674d8a68c23e', -- ahmed.elgamal@test.com (keep naam version)
  '8bbb1271-f46c-408a-8457-2e2c4ac444f2', -- ahmed.khater@test.com  (keep naam version)
  'eebd85e8-85f4-4b8d-8d1c-802c669f08ba', -- noura@test.com         (noura@coceg.net exists)
  '9adc6332-a77d-4687-a552-9b8acb3ed627', -- sara@test.com          (sara@coceg.net exists)
  '48e50d06-73e7-46dc-93b2-77a11d533cfc'  -- mohamed.shaala@naam-capital.com (mohamed.shaala@coceg.net exists)
);

-- 2) Rename remaining @test.com and @naam-capital.com -> @coceg.net (auth.users)
UPDATE auth.users
SET email = regexp_replace(email, '@(test\.com|naam-capital\.com)$', '@coceg.net'),
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('email', regexp_replace(email, '@(test\.com|naam-capital\.com)$', '@coceg.net')),
    updated_at = now()
WHERE email ~* '@(test\.com|naam-capital\.com)$';

-- 3) Sync public.profiles.email with the new auth email
UPDATE public.profiles p
SET email = u.email, updated_at = now()
FROM auth.users u
WHERE p.id = u.id AND p.email IS DISTINCT FROM u.email;
