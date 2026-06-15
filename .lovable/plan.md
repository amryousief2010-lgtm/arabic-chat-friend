# خطة تنفيذ الميزانية الشهرية للأقسام

## الهدف
صفحة عرض-فقط تحسب تلقائيًا الإيرادات والمصروفات والصافي لكل قسم (معمل التفريخ، حضانات التسمين، المجزر، مصنع العلف) لشهر/سنة مختارين، بدون أي تعديل على الأرصدة أو الخزن أو المخزون.

## الملفات الجديدة

### 1. Edge Function: `supabase/functions/department-monthly-budget/index.ts`
- يستقبل `{ year, month }`
- يستعلم بـ service role من الجداول التالية لكل قسم ضمن نطاق الشهر:
  - **معمل التفريخ**: `hatchery_client_invoices` (إيراد) + `hatchery_treasury_txns` نوع expense (مصروف)
  - **حضانات التسمين**: `brooding_chick_sales` (إيراد) + `brooding_expenses` + `brooding_feed_issuance` + `brooding_mortality` (مصروف)
  - **المجزر**: `slaughter_branch_transfers` قيمة المنتجات (إيراد افتراضي) + `slaughter_custody_expenses` + `slaughterhouse_feed_movements` (مصروف)
  - **مصنع العلف**: `feed_sales` + `feed_internal_payments` (إيراد) + `feed_raw_purchases` + `feed_factory_treasury_txns` expense (مصروف)
- يرجع JSON منظم: `{ departments: [...], totals, topRevenueSources, topExpenseItems, alerts, previousMonthComparison, unclassified }`
- يحسب أيضًا الشهر السابق للمقارنة

### 2. الصفحة: `src/pages/modules/DepartmentMonthlyBudget.tsx`
- اختيار شهر/سنة (defaults: الشهر الحالي Cairo TZ — استخدم `currentCairoYearMonth` من `@/lib/cairoDate`)
- استدعاء الـ edge function بـ `supabase.functions.invoke`
- العناصر:
  1. **كروت أعلى الصفحة**: إجمالي الإيرادات، المصروفات، الصافي، أكثر قسم ربحًا/خسارة، أعلى قسم إيراد/مصروف، أكبر بند مصروف، أكبر مصدر إيراد
  2. **جدول مقارنة الأقسام**: قسم/إيرادات/مصروفات/صافي/نسبة المصروفات/الحالة (Badge: كسبان/خسران/تعادل)
  3. **أكثر مصادر الربح** (table)
  4. **أكبر بنود الخسارة** (table)
  5. **مقارنة بالشهر السابق** لكل قسم
  6. **تنبيهات ذكية** (alerts cards)
  7. **حركات غير مصنفة** قسم منفصل
  8. **تفاصيل القسم** عند النقر (Dialog): جداول الإيرادات والمصروفات التفصيلية
- أزرار: طباعة (`openPrintWindow` من `@/lib/printPdf`)، تصدير Excel (`xlsx`)
- استخدم RTL، الألوان Purple/Orange، framer-motion للانتقالات

### 3. التسجيل في التوجيه والقائمة الجانبية
- `src/components/AnimatedRoutes.tsx`: مسار `/modules/department-monthly-budget`
- `src/components/layout/SidebarMenuSections.tsx`: عنصر جديد تحت قسم التقارير أو قسم جديد "الإدارة المالية" — اسم: "الميزانية الشهرية للأقسام"، أيقونة `Wallet` أو `Scale`

## ملاحظات تقنية
- لا migrations — قراءة فقط
- استخدام `cairoMonthStartUTC` و `cairoYearStartUTC` لحدود الشهر بتوقيت القاهرة
- Edge function لتجنب multiple round-trips ولتجاوز RLS بأمان للقراءة فقط
- صلاحيات العرض: General/Executive Manager + Accountant
- بدون تعديل أي حركة أو خزنة — صفحة قراءة فقط 100%
