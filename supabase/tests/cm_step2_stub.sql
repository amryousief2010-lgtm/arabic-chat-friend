-- بيئة اختبار محلية فقط (تكملة cm_step1_stub.sql): customers و orders.customer_id و normalize_phone_eg.
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, phone text NOT NULL, phone2 text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- نسخة مطابقة من الدالة الموجودة في المستودع (normalize_phone_eg)
CREATE OR REPLACE FUNCTION public.normalize_phone_eg(input text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE s text := COALESCE(input, '');
BEGIN
  s := translate(s, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  s := regexp_replace(trim(s), '[^0-9+]', '', 'g');
  IF s LIKE '+20%' THEN s := substr(s, 4);
  ELSIF s LIKE '0020%' THEN s := substr(s, 5);
  ELSIF s ~ '^20[0-9]{10}$' THEN s := substr(s, 3);
  END IF;
  IF s ~ '^1[0-9]{9}$' THEN s := '0' || s; END IF;
  RETURN s;
END; $$;
GRANT SELECT ON public.customers, public.orders TO authenticated;
INSERT INTO public.customers (id, name, phone, phone2) VALUES
  ('00000000-0000-0000-0000-00000000c001','عميل 1','01012345678',NULL),
  ('00000000-0000-0000-0000-00000000c002','عميل 1 مكرر','+20 10 1234 5678',NULL),
  ('00000000-0000-0000-0000-00000000c003','رقمين','01112223334 / 01223334445',NULL),
  ('00000000-0000-0000-0000-00000000c004','مشوه','12345',NULL),
  ('00000000-0000-0000-0000-00000000c005','خط ساخن','0201098765432','٠١٥٥٥٦٦٦٧٧٧');
INSERT INTO public.orders (moderator, total, customer_id, created_at) VALUES
  (NULL, 1, '00000000-0000-0000-0000-00000000c001', '2026-09-01'),
  (NULL, 1, '00000000-0000-0000-0000-00000000c002', '2026-10-01');
