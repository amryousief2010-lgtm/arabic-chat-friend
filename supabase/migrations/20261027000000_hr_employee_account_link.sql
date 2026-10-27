-- المرحلة 2: ربط الموظف بحساب الدخول (إضافي فقط — لا يغيّر بيانات)
-- حساب الدخول لا يُربط إلا بموظف واحد.
CREATE UNIQUE INDEX IF NOT EXISTS hr_employees_user_id_unique
  ON public.hr_employees (user_id) WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.hr_employees.user_id IS
  'حساب الدخول المربوط بالموظف (اختياري). مصدر الصورة الموحد: profiles.avatar_url ثم hr_employees.photo_url';
