-- للموافقة فقط — مش متطبق. ربط الحملات بالخطوط (تحديد م. عمرو يوسف، 21/11/2026). لا كتابة في cm_ad_attributions.
--   «اية72»        → خط مريم: مربوطة بالفعل من 1/11 (مفيش تغيير؛ التحقق بس).
--   «هاجر جديد 696» → خط هاجر: الخط مش موجود في النظام (مش على ميتا) → ننشئه app_only / not_connected ونربط.
--   «فنادق 578»     → خط المدير التنفيذي أ. أحمد الجمل: مش متوصل بمحادثات coceg → ننشئه app_only / not_connected بدون موديريتور ونربط.
--   «لحوم 2»        → حملة ميتا من غير موديريتور: مفيش خط تتربط بيه → تفضل غير مربوطة «غير متتبعة عن قصد».
--                     الجدول مفيهوش علامة «غير متتبعة»؛ تنبيه A5 بيطلع مرة واحدة بس (المفتاح من غير تاريخ) ويتقفل من صفحة التنبيهات.
-- أثر الربط: A5 يبطّل يعتبر هاجر/فنادق «مش متتبعة». المحادثات مش هتتنسب للحملتين (الخطين برة النظام)،
-- فـ A3 (صرف من غير أوردرات) ممكن يطلع لو صرف اليوم ≥ 700 جنيه (آخر 14 يوم: هاجر ~394/يوم، فنادق ~156/يوم).

-- معاينة (قراءة فقط)
SELECT cp.name, cp.status,
       (SELECT round(sum(s.spend)) FROM public.cm_ad_spend_daily s WHERE s.campaign_id = cp.id AND s.spend_date >= current_date - 14) AS spend_14d,
       (SELECT string_agg(l.label || ' من ' || mp.valid_from, '، ') FROM public.cm_campaign_line_map mp JOIN public.cm_lines l ON l.id = mp.line_id WHERE mp.campaign_id = cp.id) AS current_map
FROM public.cm_campaigns cp WHERE cp.name IN ('لحوم 2', 'هاجر جديد 696', 'فنادق 578', 'اية72');

BEGIN;
SET LOCAL lock_timeout = '3s';
-- 1) خطين خارج النظام (بدون أرقام تليفون؛ تتضاف بعدين من صفحة الخطوط لو لزم)
INSERT INTO public.cm_lines (channel_id, label, mode, owner_moderator_id, is_api_line, meta_registered, connection_status)
SELECT ch.id, v.label, 'app_only', (SELECT m.id FROM public.cm_moderators m WHERE m.slug = v.mod_slug), false, false, 'not_connected'
FROM (VALUES ('خط هاجر', 'manal'), ('خط أ. أحمد الجمل — المدير التنفيذي', NULL)) v(label, mod_slug)
CROSS JOIN LATERAL (SELECT id FROM public.cm_channels WHERE kind = 'whatsapp' LIMIT 1) ch
ON CONFLICT (label) DO NOTHING;

-- 2) الربط من 1/11/2026 (زي اية72)
INSERT INTO public.cm_campaign_line_map (campaign_id, line_id, valid_from)
SELECT cp.id, l.id, date '2026-11-01'
FROM (VALUES ('هاجر جديد 696', 'خط هاجر'), ('فنادق 578', 'خط أ. أحمد الجمل — المدير التنفيذي')) v(campaign, line)
JOIN public.cm_campaigns cp ON cp.name = v.campaign
JOIN public.cm_lines l ON l.label = v.line
WHERE NOT EXISTS (SELECT 1 FROM public.cm_campaign_line_map x WHERE x.campaign_id = cp.id AND x.valid_to IS NULL);

-- 3) تحقق: لازم 2 خط جديد، 2 ربط جديد، اية72 على خط مريم، لحوم 2 من غير ربط
SELECT cp.name, string_agg(l.label || ' (' || l.mode || ')', '، ') AS lines
FROM public.cm_campaigns cp LEFT JOIN public.cm_campaign_line_map mp ON mp.campaign_id = cp.id AND mp.valid_to IS NULL
LEFT JOIN public.cm_lines l ON l.id = mp.line_id
WHERE cp.name IN ('لحوم 2', 'هاجر جديد 696', 'فنادق 578', 'اية72') GROUP BY cp.name;
ROLLBACK;
