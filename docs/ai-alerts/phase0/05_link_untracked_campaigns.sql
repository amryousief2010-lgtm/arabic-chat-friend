-- للموافقة فقط. 3 حملات بتصرف من غير ربط بخط (21% من صرف آخر 14 يوم): لحوم 2، هاجر جديد 696، فنادق 578.
-- محتاج م. عمرو يحدد كل حملة تتربط بأنهي خط. لاحظ إن خط هاجر مش على ميتا، فالمحادثات مش هتتنسب حتى بعد الربط.
SELECT cp.id, cp.name, (SELECT sum(spend) FROM public.cm_ad_spend_daily s WHERE s.campaign_id = cp.id AND s.spend_date >= current_date - 14) AS spend_14d
FROM public.cm_campaigns cp WHERE cp.name IN ('لحوم 2', 'هاجر جديد 696', 'فنادق 578');
SELECT l.id, l.label, m.display_name AS owner, l.meta_registered FROM public.cm_lines l LEFT JOIN public.cm_moderators m ON m.id = l.owner_moderator_id ORDER BY l.label;

BEGIN;
-- استبدل <LINE_ID> بالخط المختار. لا كتابة في cm_ad_attributions.
INSERT INTO public.cm_campaign_line_map (campaign_id, line_id, valid_from)
SELECT cp.id, v.line_id, date '2026-11-01'
FROM (VALUES ('لحوم 2', '<LINE_ID>'::uuid), ('هاجر جديد 696', '<LINE_ID>'::uuid), ('فنادق 578', '<LINE_ID>'::uuid)) v(name, line_id)
JOIN public.cm_campaigns cp ON cp.name = v.name;
ROLLBACK;
