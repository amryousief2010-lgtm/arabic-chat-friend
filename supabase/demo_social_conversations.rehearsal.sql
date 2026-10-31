-- بيانات عرض تجريبية (is_demo = true) لمراجعة شاشات ماسنجر/إنستجرام على البروفة فقط. للحذف:
-- DELETE FROM cm_conversations WHERE is_demo; DELETE FROM cm_contacts WHERE external_id LIKE 'DEMO-%';
SELECT public.cm_ingest_social_message(ch, 'DEMO', ext, dir, mid, now() - (mins || ' minutes')::interval, typ, body,
  jsonb_build_object('demo', true), name, handle, ad, CASE WHEN ad IS NOT NULL THEN 'ad' END, head, true)
FROM (VALUES
 ('messenger','DEMO-PSID-1','in','demo.m.1',180,'text','[تجريبي] السلام عليكم، بكام بوكس التوفير؟','تجريبي — أحمد محمود',NULL,'DEMO-AD-1','[تجريبي] إعلان بوكس التوفير — ماسنجر'),
 ('messenger','DEMO-PSID-1','out','demo.m.2',175,'text','[تجريبي] أهلاً بحضرتك، السعر والتفاصيل في الصورة.','تجريبي — أحمد محمود',NULL,NULL,NULL),
 ('messenger','DEMO-PSID-1','out','demo.m.3',174,'image','https://example.invalid/demo.jpg','تجريبي — أحمد محمود',NULL,NULL,NULL),
 ('messenger','DEMO-PSID-2','in','demo.m.4',40,'text','[تجريبي] متاح توصيل للتجمع؟','تجريبي — سارة علي',NULL,NULL,NULL),
 ('instagram','DEMO-IGSID-1','in','demo.ig.1',95,'text','[تجريبي] عايزة أطلب نعام متبّل','تجريبي — منى',  'demo_mona','DEMO-AD-2','[تجريبي] إعلان نعام متبّل — إنستجرام'),
 ('instagram','DEMO-IGSID-1','out','demo.ig.2',90,'text','[تجريبي] تمام يا فندم، ابعتي العنوان ورقم الموبايل.','تجريبي — منى','demo_mona',NULL,NULL),
 ('instagram','DEMO-IGSID-2','in','demo.ig.3',15,'story_reply','[تجريبي] رد على الستوري: لسه العرض شغال؟','تجريبي — كريم','demo_karim',NULL,NULL)
) v(ch, ext, dir, mid, mins, typ, body, name, handle, ad, head);
