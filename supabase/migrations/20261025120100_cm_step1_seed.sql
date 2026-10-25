-- بذور الخطوة 1 (قابلة لإعادة التشغيل، ON CONFLICT DO NOTHING فلا تكتب فوق تعديلات مديرة المبيعات).
-- المصدر: src/constants/moderators.ts وقرارات المدير العام 25/10/2026. لا أرقام هواتف.

INSERT INTO public.cm_moderators (slug, display_name, canonical_name, payroll_key, is_active, chat_active, start_date, end_date, sort_order, user_id)
VALUES
  ('noura','نورا','نورا','نورا',true,true,NULL,NULL,1,NULL),
  ('aya','آية','أية','اية',true,true,NULL,NULL,2,NULL),
  ('manal','هاجر','هاجر','منال',true,true,NULL,NULL,3,NULL),
  ('soha','سها','سها','سها',true,true,'2026-10-01',NULL,4,NULL),
  ('mariam','مريم','مريم','مريم',true,true,'2026-09-01','2026-10-31',5,NULL),
  ('fatma','فاطمة','فاطمة','فاطمة',true,false,NULL,NULL,6,NULL)
ON CONFLICT (slug) DO NOTHING;

-- ربط الحسابات المعروفة في الكود (يتجاهل إن لم يوجد المستخدم).
UPDATE public.cm_moderators m SET user_id = v.uid
FROM (VALUES ('soha','295046a4-aea0-4eb4-a069-85a68cc30cb3'::uuid),
             ('fatma','8c1c8fb3-6c1b-449d-9ea3-ce691becce5a'::uuid)) v(slug, uid)
WHERE m.slug = v.slug AND m.user_id IS NULL
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v.uid)
  AND NOT EXISTS (SELECT 1 FROM public.cm_moderators x WHERE x.user_id = v.uid);

INSERT INTO public.cm_moderator_aliases (moderator_id, alias)
SELECT m.id, a.alias
FROM (VALUES
  ('aya','اية'),('aya','آية'),('aya','أية'),('aya','ايه'),('aya','آيه'),('aya','أيه'),
  ('noura','نورا'),('noura','نوره'),('noura','نورة'),
  ('manal','منال'),('manal','هاجر'),
  ('mariam','مريم'),('mariam','مريام'),
  ('soha','سها'),
  ('fatma','فاطمة')) a(slug, alias)
JOIN public.cm_moderators m ON m.slug = a.slug
ON CONFLICT DO NOTHING;

-- السبت(6)/الأحد(0)/الاثنين(1): 4 شيفتات. الثلاثاء(2)–الجمعة(5): 3 شيفتات.
INSERT INTO public.cm_weekday_patterns (dow, day_pattern) VALUES
  (6,'four_shift'),(0,'four_shift'),(1,'four_shift'),
  (2,'three_shift'),(3,'three_shift'),(4,'three_shift'),(5,'three_shift')
ON CONFLICT (dow) DO NOTHING;

INSERT INTO public.cm_shift_templates (day_pattern, slot_no, label, starts_at, ends_at) VALUES
  ('four_shift',1,'الشيفت الأول','09:00','13:00'),
  ('four_shift',2,'الشيفت الثاني','13:00','17:00'),
  ('four_shift',3,'الشيفت الثالث','17:00','21:00'),
  ('four_shift',4,'الشيفت الرابع','21:00','01:00'),
  ('three_shift',1,'الشيفت الأول','09:00','14:00'),
  ('three_shift',2,'الشيفت الثاني','14:00','20:00'),
  ('three_shift',3,'الشيفت الثالث','20:00','01:00')
ON CONFLICT (day_pattern, slot_no) DO NOTHING;

INSERT INTO public.cm_distribution_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO public.cm_kpi_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO public.cm_retention_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO public.cm_governance_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

INSERT INTO public.cm_channels (kind, name) VALUES
  ('whatsapp','واتساب'),('messenger','ماسنجر'),('instagram','إنستجرام'),('hotline','الخط الساخن')
ON CONFLICT (kind) DO NOTHING;

-- خط مودريتور 1: علامة فقط (api)، غير مسجَّل وغير مربوط بميتا. لا رقم.
INSERT INTO public.cm_lines (channel_id, label, mode, is_api_line, meta_registered, connection_status)
SELECT c.id, 'خط مودريتور 1', 'api', true, false, 'not_connected'
FROM public.cm_channels c WHERE c.kind = 'whatsapp'
ON CONFLICT (label) DO NOTHING;

-- المراجعة المتبادلة: نفس أزواج السياسات الثلاث الحالية (خانة منال = هاجر).
-- «Manal can review Nora and Aya» → هاجر تراجع نورا وآية؛ «Nora can review Hagar» → نورا تراجع هاجر.
-- السياسات القديمة على orders/order_items باقية كما هي؛ هذا الجدول لا يغيّر أي صلاحية على الطلبات بعد.
-- المراجعة المتبادلة: هذه الأزواج افتراضي أولي فقط (مأخوذ من السياسات الاسمية الحالية).
-- مديرة المبيعات (والمدير العام) تضيف وتلغي الأزواج من صفحة «إعدادات التوزيع والمؤشرات» ← «المراجعة المتبادلة».
-- لاحقاً (PR منفصل بعد اختبار التطابق) تُستبدل السياسات الاسمية الثلاث على orders/order_items
-- بسياسة واحدة تعتمد على cm_peer_review (valid_to IS NULL).
INSERT INTO public.cm_peer_review (reviewer_moderator_id, reviewee_moderator_id, valid_from, source_policy)
SELECT r.id, e.id, '2026-10-25', p.src
FROM (VALUES ('manal','noura','Manal can review Nora and Aya orders'),
             ('manal','aya','Manal can review Nora and Aya orders'),
             ('noura','manal','Nora can review Hagar orders')) p(rv, re, src)
JOIN public.cm_moderators r ON r.slug = p.rv
JOIN public.cm_moderators e ON e.slug = p.re
ON CONFLICT DO NOTHING;

-- الجدول الفعلي لأسبوع 24–30 أكتوبر 2026 (3 شيفتات كما أرسلته مديرة المبيعات):
-- الأول نورا، الثاني آية، الثالث هاجر.
INSERT INTO public.cm_roster_days (work_date, day_pattern, notes)
SELECT d::date, 'three_shift', 'جدول فعلي مستورد (24–30 أكتوبر 2026)'
FROM generate_series('2026-10-24'::date, '2026-10-30'::date, interval '1 day') d
ON CONFLICT (work_date) DO NOTHING;

INSERT INTO public.cm_shift_assignments (work_date, slot_no, label, starts_at, ends_at, moderator_id, source)
SELECT d::date, t.slot_no, t.label, t.starts_at, t.ends_at, m.id, 'seed'
FROM generate_series('2026-10-24'::date, '2026-10-30'::date, interval '1 day') d
JOIN public.cm_shift_templates t ON t.day_pattern = 'three_shift'
JOIN public.cm_moderators m ON m.slug = (ARRAY['noura','aya','manal'])[t.slot_no]
ON CONFLICT (work_date, slot_no) DO NOTHING;

-- ملء orders.moderator_id للطلبات القديمة لا يتم هنا (حجم بيانات الإنتاج + triggers جدول orders).
-- يُشغَّل يدوياً بعد النشر: scripts/cm/post_deploy_backfill_orders_moderator_id.sql (على دفعات، آمن للتكرار).
