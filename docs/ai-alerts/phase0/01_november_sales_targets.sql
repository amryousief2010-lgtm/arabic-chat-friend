-- للموافقة فقط — مش متطبق. أهداف نوفمبر 2026: الإجمالي 2,000,000 جنيه (من م. عمرو يوسف، 21/11/2026).
-- sales_targets لكل مستخدم (UNIQUE user_id, month, year)، فلازم يتقسم الإجمالي على الموديريتورز.
-- التقسيم لسه ما اتحددش: اختار اختيار واحد بس (أ أو ب أو ج)، وغيّر ROLLBACK لـ COMMIT في البلوك ده بس.
-- أصحاب أهداف أكتوبر (5 صفوف، إجمالي 3,250,000): آية 800k، سها 800k، نورا 650k، هاجر 500k، مريم 500k. فاطمة مالهاش هدف أكتوبر.
-- ملاحظة: M11 بيقرأ الهدف عن طريق cm_moderators.user_id؛ نورا وآية وهاجر ومريم مش مربوطين لسه (ملف 02)،
-- فالهدف هيتسجل على حساباتهم دلوقتي بس M11 مش هيشوفه غير بعد ملف 02.

-- معاينة (قراءة فقط): أهداف أكتوبر ونوفمبر الحالية
SELECT t.month, coalesce(p.full_name, '?') AS name, t.target_amount
FROM public.sales_targets t LEFT JOIN public.profiles p ON p.id = t.user_id
WHERE t.year = 2026 AND t.month IN (10, 11) ORDER BY t.month, t.target_amount DESC;

-- ───────── اختيار (أ): بنفس نسب أكتوبر (×2,000,000/3,250,000 مقرّب لأقرب 100) ─────────
-- آية 492,300 · سها 492,300 · نورا 400,000 · هاجر 307,700 · مريم 307,700 = 2,000,000 (فاطمة بدون هدف)
BEGIN;
SET LOCAL lock_timeout = '3s';
INSERT INTO public.sales_targets (user_id, target_amount, achieved_amount, month, year)
SELECT t.user_id,
       CASE t.target_amount WHEN 800000 THEN 492300 WHEN 650000 THEN 400000 WHEN 500000 THEN 307700 END,
       0, 11, 2026
FROM public.sales_targets t
WHERE t.month = 10 AND t.year = 2026 AND t.target_amount IN (800000, 650000, 500000)
ON CONFLICT (user_id, month, year) DO NOTHING;
SELECT sum(target_amount) AS nov_total, count(*) AS rows FROM public.sales_targets WHERE month = 11 AND year = 2026; -- لازم 2,000,000 و 5
ROLLBACK;

-- ───────── اختيار (ب): بالتساوي على نفس الخمسة (400,000 لكل واحدة) ─────────
BEGIN;
SET LOCAL lock_timeout = '3s';
INSERT INTO public.sales_targets (user_id, target_amount, achieved_amount, month, year)
SELECT t.user_id, 400000, 0, 11, 2026
FROM public.sales_targets t WHERE t.month = 10 AND t.year = 2026
ON CONFLICT (user_id, month, year) DO NOTHING;
SELECT sum(target_amount) AS nov_total, count(*) AS rows FROM public.sales_targets WHERE month = 11 AND year = 2026; -- لازم 2,000,000 و 5
ROLLBACK;

-- ───────── اختيار (ج): بالتساوي على الستة بما فيهم فاطمة (333,333 × 5 + 333,335 لسها) ─────────
BEGIN;
SET LOCAL lock_timeout = '3s';
INSERT INTO public.sales_targets (user_id, target_amount, achieved_amount, month, year)
SELECT u.user_id, CASE WHEN u.is_soha THEN 333335 ELSE 333333 END, 0, 11, 2026
FROM (
  SELECT t.user_id, (m.slug = 'soha') AS is_soha FROM public.sales_targets t
  LEFT JOIN public.cm_moderators m ON m.user_id = t.user_id WHERE t.month = 10 AND t.year = 2026
  UNION
  SELECT m.user_id, false FROM public.cm_moderators m WHERE m.slug = 'fatma' AND m.user_id IS NOT NULL
) u
ON CONFLICT (user_id, month, year) DO NOTHING;
SELECT sum(target_amount) AS nov_total, count(*) AS rows FROM public.sales_targets WHERE month = 11 AND year = 2026; -- لازم 2,000,000 و 6
ROLLBACK;
