-- للموافقة فقط. جدول الشيفتات آخر يوم فيه 6 نوفمبر 2026.
-- الطريقة المفضلة: م. آلاء تسجّل الشيفتات من صفحة «الشيفتات والأجازات». الملف ده بديل بينسخ أسبوع 31 أكتوبر–6 نوفمبر
-- لحد 30 نوفمبر (نفس اليوم من الأسبوع)، ولازم يتراجع بعده لأي إجازات.
SELECT work_date, count(*) AS shifts FROM public.cm_shift_assignments WHERE work_date BETWEEN date '2026-10-31' AND date '2026-11-06' GROUP BY 1 ORDER BY 1;

BEGIN;
INSERT INTO public.cm_roster_days (work_date, day_pattern, notes)
SELECT g::date, r.day_pattern, 'منسوخ من أسبوع 31/10–6/11 (مرحلة 0، بموافقة م. عمرو)'
FROM generate_series(date '2026-11-07', date '2026-11-30', interval '1 day') g
JOIN public.cm_roster_days r ON r.work_date = date '2026-10-31' + ((g::date - date '2026-10-31') % 7)
ON CONFLICT (work_date) DO NOTHING;

INSERT INTO public.cm_shift_assignments (work_date, slot_no, label, starts_at, ends_at, moderator_id, source)
SELECT g::date, s.slot_no, s.label, s.starts_at, s.ends_at, s.moderator_id, 'phase0_copy'
FROM generate_series(date '2026-11-07', date '2026-11-30', interval '1 day') g
JOIN public.cm_shift_assignments s ON s.work_date = date '2026-10-31' + ((g::date - date '2026-10-31') % 7)
WHERE NOT EXISTS (SELECT 1 FROM public.cm_shift_assignments x WHERE x.work_date = g::date);
ROLLBACK;
