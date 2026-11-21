-- للموافقة فقط. أهداف نوفمبر 2026 (sales_targets بالجنيه، زي صفحة الأهداف). القيم ناقصة: محتاجة أرقام من م. عمرو.
-- sales_targets مربوطة بـ user_id، فالمودريتور لازم يكون مربوط بحساب الأول (ملف 02).
SELECT m.display_name, m.user_id, t.target_amount AS october_target
FROM public.cm_moderators m
LEFT JOIN public.sales_targets t ON t.user_id = m.user_id AND t.month = 10 AND t.year = 2026
WHERE m.is_active ORDER BY m.sort_order;

BEGIN;
-- استبدل <TARGET_EGP> بالرقم لكل مودريتور.
INSERT INTO public.sales_targets (user_id, target_amount, achieved_amount, month, year)
SELECT m.user_id, v.target, 0, 11, 2026
FROM (VALUES ('soha', <TARGET_EGP>::numeric), ('fatma', <TARGET_EGP>::numeric)
             -- , ('noura', <TARGET_EGP>), ('aya', <TARGET_EGP>), ('manal', <TARGET_EGP>), ('mariam', <TARGET_EGP>)  -- بعد ملف 02
     ) v(slug, target)
JOIN public.cm_moderators m ON m.slug = v.slug AND m.user_id IS NOT NULL
WHERE NOT EXISTS (SELECT 1 FROM public.sales_targets t WHERE t.user_id = m.user_id AND t.month = 11 AND t.year = 2026);
ROLLBACK;
