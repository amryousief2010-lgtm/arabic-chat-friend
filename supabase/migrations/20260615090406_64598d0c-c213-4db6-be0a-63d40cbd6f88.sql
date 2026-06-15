
DO $$
DECLARE
  v_old_id uuid := '1e7cbc78-5283-4427-8b17-f824b1e81603';
  v_new_id uuid := gen_random_uuid();
  v_email text := 'abdelmonem.osman@coceg.net';
  v_password text := 'Warehouse@2026';
  v_actor uuid;
BEGIN
  UPDATE auth.users SET banned_until = 'infinity', updated_at = now() WHERE id = v_old_id;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated',
    v_email, crypt(v_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name','عبدالمنعم عثمان'),
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_new_id,
    jsonb_build_object('sub', v_new_id::text, 'email', v_email),
    'email', v_new_id::text, now(), now(), now()
  );

  UPDATE public.user_roles SET role = 'warehouse_supervisor' WHERE user_id = v_new_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_new_id, 'warehouse_supervisor')
    ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles WHERE user_id = v_old_id AND role = 'warehouse_supervisor';

  v_actor := COALESCE(auth.uid(), v_new_id);
  INSERT INTO public.hr_audit_log (action, entity_type, entity_id, performed_by, reason, before_data, after_data)
  VALUES
    ('disable_user','profile',v_old_id,v_actor,
     'تغيير مسؤول المخازن من عبدالهادي إلى عبدالمنعم عثمان - تم تعطيل الحساب لانتهاء عمل الموظف',
     jsonb_build_object('role','warehouse_supervisor','active',true),
     jsonb_build_object('role',null,'active',false,'banned',true)),
    ('create_user','profile',v_new_id,v_actor,
     'تغيير مسؤول المخازن من عبدالهادي إلى عبدالمنعم عثمان - إنشاء الحساب الجديد',
     null,
     jsonb_build_object('email',v_email,'full_name','عبدالمنعم عثمان','role','warehouse_supervisor'));
END $$;
