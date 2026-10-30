-- المرحلة 1 من مقترح الموارد البشرية: جداول إضافية فقط (لا تعديل على hr_employees).
-- مدير القسم بيانات قابلة للتعديل، ويُترك فارغًا هنا عمدًا (لم يُعتمد بعد).
CREATE TABLE IF NOT EXISTS public.hr_departments (
  code text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  parent_code text REFERENCES public.hr_departments(code),
  manager_user_id uuid NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hr_job_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_code text NOT NULL REFERENCES public.hr_departments(code),
  title text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (department_code, title)
);

ALTER TABLE public.hr_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_job_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_departments_read ON public.hr_departments;
CREATE POLICY hr_departments_read ON public.hr_departments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS hr_departments_write ON public.hr_departments;
CREATE POLICY hr_departments_write ON public.hr_departments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'general_manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'general_manager'::app_role));

DROP POLICY IF EXISTS hr_job_titles_read ON public.hr_job_titles;
CREATE POLICY hr_job_titles_read ON public.hr_job_titles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS hr_job_titles_write ON public.hr_job_titles;
CREATE POLICY hr_job_titles_write ON public.hr_job_titles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'general_manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'general_manager'::app_role));

INSERT INTO public.hr_departments (code, name, parent_code, sort_order) VALUES
 ('executive','الإدارة العليا',NULL,1),
 ('sales','المبيعات','executive',2),
 ('customer_service','خدمة العملاء','sales',3),
 ('shipping','الشحن والتوصيل','sales',4),
 ('marketing','التسويق','executive',5),
 ('finance','الحسابات والمالية','executive',6),
 ('operations','الإنتاج والتشغيل','executive',7),
 ('farm','المزرعة','operations',8),
 ('hatchery','معمل التفريخ','operations',9),
 ('slaughterhouse','المجزر','operations',10),
 ('meat_factory','مصنع اللحوم','operations',11),
 ('warehouses','المخازن','operations',12),
 ('support','الدعم الإداري','executive',13),
 ('hr','الموارد البشرية','support',14),
 ('it','تقنية المعلومات','support',15),
 ('services','الخدمات المساندة','support',16)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.hr_job_titles (department_code, title, description, sort_order) VALUES
 ('executive','المدير العام','قيادة الشركة واعتماد القرارات',1),
 ('executive','المدير التنفيذي','إدارة التشغيل اليومي للأقسام',2),
 ('executive','مساعد إداري','دعم الإدارة العليا والمراسلات',3),
 ('sales','مدير المبيعات','قيادة فريق المبيعات وتحقيق التارجت',1),
 ('sales','مشرف موديريتورز','متابعة أداء الموديريتورز وجودة الطلبات',2),
 ('sales','موديريتور مبيعات','استقبال الطلبات والرد على العملاء',3),
 ('customer_service','مشرف خدمة العملاء','متابعة الشكاوى وجودة الخدمة',1),
 ('customer_service','موظف خط ساخن','الرد على المتصلين',2),
 ('customer_service','متابعة شكاوى','متابعة ما بعد البيع',3),
 ('shipping','منسق شحن','تنظيم تسليم الطلبات',1),
 ('shipping','متابعة شحن العاصمة','متابعة البوالص والتحصيل',2),
 ('shipping','مندوب توصيل','توصيل الطلبات للعملاء',3),
 ('shipping','سائق','نقل البضائع والأفراد',4),
 ('marketing','مدير التسويق','تخطيط الحملات والهوية',1),
 ('marketing','مسؤول تسويق رقمي','إدارة الإعلانات والصفحات',2),
 ('marketing','مصمم محتوى','تصميم المنشورات والفيديوهات',3),
 ('marketing','أخصائي دعاية وتسويق','تنفيذ الحملات والعروض',4),
 ('finance','مدير مالي','الإشراف على الحسابات والخزائن',1),
 ('finance','محاسب عام','القيود والفواتير',2),
 ('finance','محاسب خزنة رئيسية','حركات الخزنة الرئيسية',3),
 ('finance','محاسب تكاليف','تكلفة الإنتاج والمخزون',4),
 ('finance','أمين خزنة','استلام وصرف النقدية',5),
 ('operations','مدير إنتاج','الإشراف على المزرعة والمعمل والمجزر والمصنع',1),
 ('farm','مشرف مزرعة','متابعة القطيع والتغذية',1),
 ('farm','عامل مزرعة أمهات','رعاية الأمهات وجمع البيض',2),
 ('farm','عامل مزرعة تسمين','رعاية التسمين',3),
 ('farm','طبيب بيطري','صحة القطيع',4),
 ('hatchery','مشرف معمل','إدارة دفعات التحضين',1),
 ('hatchery','فني تفريخ','التحضين والفقس',2),
 ('hatchery','عامل معمل','رعاية الكتاكيت والنظافة',3),
 ('slaughterhouse','مشرف مجزر','إدارة دفعات الذبح',1),
 ('slaughterhouse','جزار','الذبح والتشفية',2),
 ('slaughterhouse','مساعد جزار','المساعدة في التجهيز',3),
 ('slaughterhouse','عامل تجهيز وتغليف','التغليف والتسليم للمخزن',4),
 ('meat_factory','مشرف وردية','متابعة خط الإنتاج',1),
 ('meat_factory','فني تصنيع','تشغيل الماكينات والوصفات',2),
 ('meat_factory','عامل إنتاج','التصنيع والتعبئة',3),
 ('meat_factory','مراقب جودة','فحص المنتجات والمواصفات',4),
 ('warehouses','أمين مخزن رئيسي','الاستلام والصرف من الرئيسي',1),
 ('warehouses','أمين مخزن فرعي','إدارة مخزن فرعي',2),
 ('warehouses','عامل مخزن','التحميل والترتيب',3),
 ('warehouses','مسؤول جرد','الجرد والمطابقة',4),
 ('hr','مسؤول موارد بشرية','ملفات الموظفين',1),
 ('hr','مسؤول رواتب وحضور','الرواتب والسلف والخصومات',2),
 ('it','مسؤول أنظمة','التطبيق والصلاحيات',1),
 ('it','دعم فني','الأجهزة والمساعدة',2),
 ('services','بواب','الحراسة والاستقبال',1),
 ('services','فرد أمن','تأمين المواقع',2),
 ('services','عامل نظافة','نظافة المواقع',3),
 ('services','مستشار قانوني','الشؤون القانونية',4)
ON CONFLICT (department_code, title) DO NOTHING;
