# سجل حركات التحضين ومصنع الأعلاف

## الهدف
إنشاء سجل حركات شامل وقابل للطباعة والتصدير لكل من قسم التحضين والتسمين وقسم مصنع الأعلاف، مع ربط الحركات المتبادلة بينهما برقم مرجعي موحد.

## 1. قاعدة البيانات

### جدول `brooding_movements` (سجل حركات التحضين)
- `movement_no` — رقم الحركة (BRD-MOV-0001) يولّد تلقائياً
- `movement_type` — نوع الحركة (enum): `batch_add`, `batch_edit`, `mortality`, `feed_issue`, `medicine_issue`, `expense`, `feed_receive`, `chicks_sale`, `slaughter_transfer`, `adjustment`, `reversal`
- `direction` — IN / OUT / NONE
- `batch_id` — رقم الدفعة (اختياري)
- `item_name` — الصنف/البيان
- `quantity`, `unit`, `unit_cost`, `total_cost`
- `from_party`, `to_party` — من/إلى
- `created_by`, `approved_by`, `approved_at`
- `status` — `posted`, `reversed`, `pending`
- `linked_movement_id` — ربط بحركة مصنع الأعلاف
- `reference_no` — رقم مرجعي موحد للحركتين المرتبطتين
- `notes`, `metadata` (jsonb)

### جدول `feed_factory_movements` (سجل حركات مصنع الأعلاف)
نفس الأعمدة مع `movement_type` الخاص بالمصنع: `raw_purchase`, `feed_production`, `external_sale`, `brooding_supply`, `feed_return`, `inventory_adjustment`, `treasury`, `stock_deduction`, `reversal`.

### Triggers
- Trigger على `brooding_feed_stock_movements` لما `source_party = 'feed_factory'` ينشئ سطرين متلازمين:
  - في `feed_factory_movements`: OUT `brooding_supply`
  - في `brooding_movements`: IN `feed_receive`
  - بنفس `reference_no` (FEED-TR-XXXX) و`linked_movement_id` متبادل
- Triggers أخرى تسجل تلقائياً: إضافة دفعة، تعديل، نافق، صرف علف على دفعة، بيع، تحويل للمجزر.

### الحذف ممنوع
- RLS policies تمنع DELETE كلياً.
- Trigger `BEFORE UPDATE` يمنع تغيير الحقول الجوهرية بعد `posted`.
- الإلغاء يتم عبر إنشاء حركة `reversal` تشير للحركة الأصلية.

## 2. واجهة المستخدم

### تبويب جديد "سجل الحركات" داخل صفحة التحضين
- جدول الحركات مع الأعمدة المطلوبة
- فلاتر: من/إلى تاريخ، نوع الحركة، الدفعة، الصنف، المستخدم، الحالة، من/إلى، رقم الحركة المرتبطة
- زر طباعة لكل صف (يفتح نافذة طباعة عربية عبر `openPrintWindow`)
- زر تصدير Excel للسجل بالكامل حسب الفلاتر
- زر طباعة تقرير الحركات حسب الفلتر
- زر "إلغاء بحركة عكسية" لمن لديه صلاحية (GM/EM)

### تبويب جديد "سجل الحركات" داخل صفحة مصنع الأعلاف
نفس البنية، مع إظهار الحركات المرتبطة بالتحضين وزر الانتقال للحركة المرتبطة.

## 3. الملفات

### إنشاء/تعديل
- `supabase/migrations/<ts>_movement_logs.sql` — جداولين + triggers + RLS + sequences
- `src/pages/modules/BroodingMovements.tsx` — مكون سجل حركات التحضين
- `src/pages/modules/FeedFactoryMovements.tsx` — مكون سجل حركات المصنع
- `src/pages/modules/Brooding.tsx` — إضافة تبويب "سجل الحركات"
- `src/pages/modules/FeedFactory.tsx` — إضافة تبويب "سجل الحركات"
- `src/lib/movementsExport.ts` — تصدير Excel مشترك
- `src/integrations/supabase/types.ts` — تحديث تلقائي بعد المايجريشن

## 4. الاختبار

بعد التطبيق، أنفذ السيناريو:
1. توريد 10 كجم علف من مصنع الأعلاف → التحضين، أتحقق ظهور سطرين مرتبطين بنفس `reference_no`.
2. صرف 5 كجم على دفعة → يظهر OUT في سجل التحضين فقط مع رقم الدفعة والتكلفة.
3. التأكد من زر الطباعة العربي يعمل وExcel يصدّر بالفلاتر.
4. تنظيف بيانات الاختبار بحركات عكسية (لا حذف).

## ملاحظات تقنية
- Sequences منفصلة لـ `brooding_movements` و`feed_factory_movements` و`reference_no` المشترك.
- الفهارس على `created_at`, `batch_id`, `reference_no`, `movement_type` لسرعة الفلترة.
- استخدام `openPrintWindow` من `@/lib/printPdf` لطباعة عربية صحيحة (memory).
- جلب البيانات بحدود 1000 سجل لكل دفعة (memory).