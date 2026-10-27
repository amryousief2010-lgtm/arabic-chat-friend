-- ⚠️ بيانات تجريبية فقط (DEMO) — ليست migration ولا تُشغَّل على قاعدة الإنتاج.
-- الغرض: تجربة صندوق الرسائل وعرض المشرفات على قاعدة محلية/staging بعد تطبيق migrations الخطوات 1–3.
-- كل الأرقام وهمية (نمط 0100000000x) وكل المعرّفات تبدأ بـ DEMO حتى يسهل حذفها (انظر قسم الحذف بالأسفل).
-- يُشغَّل كمستخدم النظام (postgres / service_role) لأن cm_ingest_whatsapp_message للنظام فقط.
\set ON_ERROR_STOP on
BEGIN;

-- خط تجريبي بمعرّف ميتا وهمي، يتبع أول قناة واتساب ويملكه أول مودريتور نشطة
INSERT INTO public.cm_lines (channel_id, label, phone_raw, phone_norm, external_id, mode, owner_moderator_id)
SELECT (SELECT id FROM public.cm_channels WHERE kind = 'whatsapp'), 'DEMO خط تجريبي', '01000000000', '01000000000', 'DEMO-PNID-1', 'api',
       (SELECT id FROM public.cm_moderators WHERE is_active ORDER BY sort_order LIMIT 1)
ON CONFLICT (label) DO NOTHING;

-- رسائل واردة وهمية (توزيع وعداد حقيقيان عبر نفس دالة الـ webhook)
SELECT public.cm_ingest_whatsapp_message('DEMO-PNID-1', '20100000000' || n::text, 'عميل تجريبي ' || n, 'DEMO.wamid.' || n,
         now() - make_interval(mins => n * 17), 'text', 'رسالة تجريبية رقم ' || n, NULL,
         CASE WHEN n % 3 = 0 THEN 'DEMO-clid-' || n END, CASE WHEN n % 3 = 1 THEN 'DEMO-ad-' || n END,
         CASE WHEN n % 3 = 1 THEN 'ad' END, NULL)
FROM generate_series(1, 8) n;

-- رسالة ثانية في أول محادثة (نفس الخيط)
SELECT public.cm_ingest_whatsapp_message('DEMO-PNID-1', '201000000001', NULL, 'DEMO.wamid.1b', now() - interval '5 minutes',
         'text', 'هل الطلب متاح؟');
COMMIT;

-- ───────────── الحذف (اختياري) ─────────────
-- BEGIN;
-- DELETE FROM public.cm_conversations WHERE line_id = (SELECT id FROM public.cm_lines WHERE external_id = 'DEMO-PNID-1');
-- DELETE FROM public.cm_contacts WHERE wa_id LIKE '20100000000%';
-- DELETE FROM public.cm_lines WHERE external_id = 'DEMO-PNID-1';
-- COMMIT;
