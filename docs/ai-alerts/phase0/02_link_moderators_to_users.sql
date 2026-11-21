-- للموافقة فقط. ربط المودريتورز بحسابات المستخدمين (نورا، آية، هاجر، مريم مش مربوطين).
-- المعاينة: المرشحين بالاسم من profiles ودور sales_moderator. لازم م. عمرو يأكد كل ربط قبل التشغيل.
SELECT m.slug, m.display_name, p.id AS candidate_user_id, p.full_name, split_part(p.email, '@', 2) AS email_domain
FROM public.cm_moderators m
JOIN public.profiles p ON translate(p.full_name, 'أإآة', 'اااه') ILIKE '%' || translate(m.display_name, 'أإآة', 'اااه') || '%'
JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'sales_moderator'
WHERE m.is_active AND m.user_id IS NULL
ORDER BY m.sort_order;

BEGIN;
-- استبدل <USER_ID> بالمعرّف المؤكد من المعاينة.
UPDATE public.cm_moderators SET user_id = '<USER_ID_NOURA>'::uuid,  updated_at = now() WHERE slug = 'noura'  AND user_id IS NULL;
UPDATE public.cm_moderators SET user_id = '<USER_ID_AYA>'::uuid,    updated_at = now() WHERE slug = 'aya'    AND user_id IS NULL;
UPDATE public.cm_moderators SET user_id = '<USER_ID_HAGAR>'::uuid,  updated_at = now() WHERE slug = 'manal'  AND user_id IS NULL;
UPDATE public.cm_moderators SET user_id = '<USER_ID_MARIAM>'::uuid, updated_at = now() WHERE slug = 'mariam' AND user_id IS NULL;
ROLLBACK;
