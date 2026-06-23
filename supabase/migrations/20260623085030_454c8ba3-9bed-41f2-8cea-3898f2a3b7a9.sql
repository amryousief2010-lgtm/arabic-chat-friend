INSERT INTO public.user_roles (user_id, role)
VALUES ('0ceaed94-a666-4af7-a68c-43288ab8f738', 'warehouse_supervisor')
ON CONFLICT (user_id, role) DO NOTHING;