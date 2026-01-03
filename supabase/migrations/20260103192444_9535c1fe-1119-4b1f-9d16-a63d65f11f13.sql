-- Step 1: Drop all dependent policies first
DROP POLICY IF EXISTS "Admins and supervisors can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins and supervisors can manage products" ON public.products;
DROP POLICY IF EXISTS "Admins and supervisors can update customers" ON public.customers;
DROP POLICY IF EXISTS "Admins and supervisors can update orders" ON public.orders;
DROP POLICY IF EXISTS "Admins and supervisors can update notifications" ON public.notifications;
DROP POLICY IF EXISTS "Admins can delete notifications" ON public.notifications;

-- Step 2: Drop dependent functions
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role);
DROP FUNCTION IF EXISTS public.get_user_role(uuid);

-- Step 3: Update enum safely
ALTER TABLE public.user_roles ALTER COLUMN role DROP DEFAULT;

-- Create new enum
CREATE TYPE public.app_role_new AS ENUM (
  'general_manager',
  'executive_manager', 
  'sales_moderator',
  'accountant',
  'warehouse_supervisor'
);

-- Convert existing data
ALTER TABLE public.user_roles 
  ALTER COLUMN role TYPE public.app_role_new 
  USING (
    CASE role::text
      WHEN 'admin' THEN 'general_manager'::public.app_role_new
      WHEN 'supervisor' THEN 'executive_manager'::public.app_role_new
      WHEN 'employee' THEN 'sales_moderator'::public.app_role_new
    END
  );

-- Drop old enum and rename new one
DROP TYPE public.app_role;
ALTER TYPE public.app_role_new RENAME TO app_role;

-- Set new default
ALTER TABLE public.user_roles ALTER COLUMN role SET DEFAULT 'sales_moderator'::public.app_role;

-- Step 4: Recreate functions with new enum
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = ANY(_roles)
  )
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- Update handle_new_user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    NEW.email
  );
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'sales_moderator');
  
  RETURN NEW;
END;
$$;

-- Step 5: Recreate RLS policies with new roles
-- Customers
CREATE POLICY "Managers can update customers" ON public.customers
FOR UPDATE USING (
  has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager']::app_role[])
);

-- Notifications
CREATE POLICY "Managers can update notifications" ON public.notifications
FOR UPDATE USING (
  has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager']::app_role[])
);

CREATE POLICY "Managers can delete notifications" ON public.notifications
FOR DELETE USING (
  has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager']::app_role[])
);

-- Orders
CREATE POLICY "Authorized roles can update orders" ON public.orders
FOR UPDATE USING (
  has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'accountant', 'warehouse_supervisor']::app_role[])
);

-- Products
CREATE POLICY "Warehouse and managers can manage products" ON public.products
FOR ALL USING (
  has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'warehouse_supervisor']::app_role[])
);

-- Profiles
CREATE POLICY "Managers can view all profiles" ON public.profiles
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager']::app_role[])
);

CREATE POLICY "General manager can update all profiles" ON public.profiles
FOR UPDATE USING (
  has_role(auth.uid(), 'general_manager')
);

-- User roles
CREATE POLICY "General manager can manage roles" ON public.user_roles
FOR ALL USING (
  has_role(auth.uid(), 'general_manager')
);

CREATE POLICY "Managers can view all roles" ON public.user_roles
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager']::app_role[])
);