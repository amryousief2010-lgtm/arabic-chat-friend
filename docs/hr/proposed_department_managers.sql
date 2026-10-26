-- مقترح فقط — ليس هجرة ولا يُطبَّق تلقائيًا. يُنفَّذ يدويًا بعد موافقة المدير العام وبعد تطبيق
-- هجرة 20261026200000_hr_departments_job_titles.sql، مع نسخة احتياطية أولًا.
-- اعتمد المدير العام (26/10/2026): م. آلاء حامد = مديرة المبيعات، محمد سيد = مدير التسويق.
-- راجع ناتج SELECT قبل UPDATE (يجب أن يرجع صفًّا واحدًا لكل قسم).
SELECT d.code, p.id, p.full_name
FROM public.hr_departments d
JOIN public.profiles p ON (d.code = 'sales' AND p.full_name LIKE '%آلاء حامد%')
                       OR (d.code = 'marketing' AND p.full_name LIKE '%محمد سيد%');

-- UPDATE public.hr_departments SET manager_user_id = '<profile id>', updated_at = now() WHERE code = 'sales';
-- UPDATE public.hr_departments SET manager_user_id = '<profile id>', updated_at = now() WHERE code = 'marketing';
