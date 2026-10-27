-- بيئة اختبار محلية فقط: محاكاة الحد الأدنى من Supabase (auth/roles/has_role/orders) لتشغيل migrations الخطوة 1.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
-- مثل Supabase: صلاحيات افتراضية لكل جدول/دالة جديدة في public لـ anon وauthenticated وservice_role
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TYPE public.app_role AS ENUM ('general_manager','executive_manager','sales_manager','sales_moderator',
  'marketing_sales_manager','marketing_sales_viewer','social_media_manager','accountant');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role = ANY(_roles)) $$;
-- نسخة مطابقة من migration 20260705162506
CREATE OR REPLACE FUNCTION public.normalize_ar_name(txt text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(translate(coalesce(txt,''), 'إأآاىةٱ', 'اااايه ا'), '\s+', ' ', 'g')) $$;
CREATE TABLE public.orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), moderator text, total numeric,
  updated_at timestamptz NOT NULL DEFAULT '2020-01-01 00:00+00');
-- محاكاة triggers المستخدم على orders: updated_at + أثر جانبي يُسجَّل (للتحقق من أن سكربت الملء لا يشغّلها في وضع replica)
CREATE TABLE public.orders_side_effects (order_id uuid, at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE FUNCTION public.stub_orders_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.orders_side_effects(order_id) VALUES (NEW.id); RETURN NEW; END $$;
CREATE TRIGGER stub_orders_side_effect AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.stub_orders_side_effect();
INSERT INTO public.orders (moderator, total) VALUES ('نورا',100),('نورة',50),('أية',70),('ايه',10),('منال',30),
  ('هاجر',20),('مريم',5),('سها',1),('مجهولة',9),(NULL,3);
-- 600 طلب إضافي لاختبار الدفعات (> 500)
INSERT INTO public.orders (moderator, total) SELECT 'مريم', 1 FROM generate_series(1,600);
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000c1'),('00000000-0000-0000-0000-0000000000d1'),('00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000f1'),('00000000-0000-0000-0000-0000000000a2'),('00000000-0000-0000-0000-0000000000a3');
INSERT INTO public.user_roles VALUES
  ('00000000-0000-0000-0000-0000000000a1','sales_manager'),
  ('00000000-0000-0000-0000-0000000000b1','executive_manager'),
  ('00000000-0000-0000-0000-0000000000c1','sales_moderator'),
  ('00000000-0000-0000-0000-0000000000d1','marketing_sales_viewer'),
  ('00000000-0000-0000-0000-0000000000e1','accountant'),
  ('00000000-0000-0000-0000-0000000000f1','social_media_manager'),
  ('00000000-0000-0000-0000-0000000000a2','marketing_sales_manager'),
  ('00000000-0000-0000-0000-0000000000a3','general_manager');
