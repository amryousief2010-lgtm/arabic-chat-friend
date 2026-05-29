
-- 1) Grant slaughterhouse_manager role to Ahmed Khater (additional role)
INSERT INTO public.user_roles (user_id, role)
VALUES ('2d124c73-fdb4-4d39-af5e-78d80ac2a0dd', 'slaughterhouse_manager')
ON CONFLICT (user_id, role) DO NOTHING;

-- 2) Create the two customer warehouses under Hady's management
INSERT INTO public.warehouses (name, type, location, description, manager_id, is_active)
VALUES
  ('هايبر هيلثي تيست', 'finished_goods', 'هايبر هيلثي تيست', 'مخزن عميل: توريد ومرتجع هايبر هيلثي تيست', '1e7cbc78-5283-4427-8b17-f824b1e81603', true),
  ('هايبر كارفور', 'finished_goods', 'هايبر كارفور', 'مخزن عميل: توريد ومرتجع هايبر كارفور', '1e7cbc78-5283-4427-8b17-f824b1e81603', true)
ON CONFLICT DO NOTHING;
