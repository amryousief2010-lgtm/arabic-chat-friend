# خطة تطوير Dashboard التحضين والتسمين

## 1. قاعدة البيانات (Migration)

### جدول جديد: `brooding_settings`
جدول إعدادات مفرد (single-row) لتخزين كل الإعدادات القابلة للتعديل:
- `default_chick_price` numeric default `1500` — سعر الكتكوت من معمل نعام العاصمة (عمر أسبوع)
- `feed_cost_per_kg_phase1` numeric default `20.238` — تركيبة يوم → 4 شهور
- `feed_cost_per_kg_phase2` numeric default `18.638` — تركيبة 4 شهور → الذبح
- `phase_split_months` integer default `4` — حد التحول بين التركيبتين
- `low_feed_alert_kg` numeric default `20`
- `mortality_alert_pct` numeric default `5`
- `print_header_color` text default `'#1b5e20'` (أخضر غامق)
- `print_accent_color` text default `'#e8f5e9'`
- `company_name` text default `'نعام العاصمة'`
- `updated_at`, `updated_by`

**RLS:**
- SELECT: كل المستخدمين المسجلين
- UPDATE: `general_manager` أو `executive_manager` فقط (عبر `has_role`)
- INSERT: نفس الصلاحية، مع `unique` constraint على صف واحد فقط

سيتم إدراج صف افتراضي واحد عبر INSERT في نفس الـ migration.

### جدول جديد: `brooding_feed_inventory`
رصيد العلف داخل قسم التحضين:
- `id`, `feed_name` text (مثلاً `علف كتاكيت نعام`)
- `current_kg` numeric
- `unit_cost` numeric (آخر تكلفة كيلو)
- `updated_at`

سيتم إدراج صف افتتاحي: `علف كتاكيت نعام` بـ 80 كيلو.

### جدول جديد: `brooding_feed_movements`
تتبع حركات العلف (إضافة/صرف):
- `id`, `feed_id` FK
- `batch_id` FK nullable (للصرف)
- `movement_type` enum: `opening` | `purchase` | `consumption` | `adjustment`
- `quantity_kg` numeric
- `unit_cost` numeric
- `total_cost` numeric (محسوب)
- `notes` text, `created_at`, `created_by`

**Trigger** على `brooding_feed_movements`:
- يحدّث `brooding_feed_inventory.current_kg` (يضيف للـ purchase/opening، يخصم للـ consumption)
- يمنع الصرف إذا الكمية أكبر من المتاح
- إذا `movement_type='consumption'` ومرتبط بـ `batch_id`، يُنشئ تلقائياً سجل في `brooding_batch_movements` بـ `cost_delta = total_cost` (يضمن أن تكلفة الدفعة تزيد)

### تعديل `brooding_batches`
لا حاجة لأعمدة جديدة — سيُحسب كل شيء من المصدر. لكن سنضيف عمود محسوب أو view:
- `current_value` = `current_count * cost_per_bird` (يُحسب في الـ frontend)

## 2. التغييرات في `src/pages/modules/Brooding.tsx`

### NewBatchDialog
- عند اختيار المصدر `hatchery`، يتم جلب `default_chick_price` من `brooding_settings` تلقائياً وضرب العدد × السعر = التكلفة الافتتاحية.
- الحقل قابل للتعديل يدوياً لكنه يُملأ تلقائياً.
- يضاف نص توضيحي: "تكلفة الكتكوت من معمل نعام العاصمة: 1500 ج/كتكوت"
- مصدر hatchery → لا يُخصم من خزنة (الموجود حالياً).

### FeedForm (نموذج صرف العلف)
- بدلاً من إدخال السعر يدوياً، يُحسب تلقائياً من عمر الدفعة:
  - عمر < 4 شهور → `feed_cost_per_kg_phase1` (20.238)
  - عمر ≥ 4 شهور → `feed_cost_per_kg_phase2` (18.638)
- يسمح للمدير العام/التنفيذي بتعديل السعر يدوياً (override checkbox).
- يخصم من `brooding_feed_inventory` عبر إنشاء حركة في `brooding_feed_movements` (Trigger يتولى الباقي).
- يعرض الرصيد المتاح ويمنع الصرف إذا غير كافٍ.

### كروت الـ Dashboard الجديدة
يتم إضافة/تحديث صف الكروت ليعرض:
1. إجمالي عدد الكتاكيت الحالي (موجود)
2. **قيمة الكتاكيت الحالية بالجنيه** = Σ(current_count × cost_per_bird) لكل دفعة، مع fallback للسعر الافتراضي (1500) إذا cost_per_bird = 0
3. إجمالي تكلفة الدفعات
4. متوسط تكلفة الطائر الحالي
5. رصيد علف كتاكيت نعام (كجم)
6. قيمة رصيد العلف الحالي
7. تكلفة العلف المصروف
8. تكلفة الأدوية المصروفة
9. مصروفات آخر 15 يوم
10. عدد النافق ونسبته
11. أرباح بيع الكتاكيت
12. تكلفة الطيور المحولة للمجزر

### تبويب جديد: "الإعدادات"
- يظهر **فقط** للمدير العام والمدير التنفيذي (`canEditSettings = isGeneralManager || isExecutiveManager`).
- يحتوي على فورم لتعديل كل حقول `brooding_settings`.
- زر حفظ + toast نجاح.

### تبويب جديد/قسم: "مخزون العلف"
- يعرض `brooding_feed_inventory` + سجل `brooding_feed_movements`.
- زر "إضافة رصيد علف" للمدير العام/التنفيذي.

## 3. تحسين الطباعة (`src/lib/printPdf.ts` أو ملف جديد)

- إنشاء helper `printBroodingReport({ title, batchNumber, rows, totals })` يستخدم الألوان من `brooding_settings`.
- التصميم:
  - Header: شعار/اسم الشركة (نعام العاصمة) — لون أخضر غامق
  - العنوان الفرعي: التحضين والتسمين
  - نوع التقرير + رقم الدفعة/الحركة + التاريخ + الحالة
  - جدول بحدود واضحة، خلفية رمادية فاتحة للرأس
  - صف الإجماليات بلون مميز (أخضر فاتح)
  - تذييل: توقيع المسؤول / توقيع المدير
- استبدال استدعاءات الطباعة الحالية في Brooding.tsx بهذا الـ helper.

## 4. الصلاحيات

- كل إجراءات التعديل (إضافة دفعة، حركات، إعدادات، رصيد علف) محصورة في `canManageBrooding` (موجود).
- تبويب الإعدادات + تعديل الأسعار/الرصيد الافتتاحي → `isGeneralManager || isExecutiveManager` فقط.

## 5. الاختبار

بعد التطبيق، تنفيذ SQL tests للتأكد من:
- صف الإعدادات الافتراضي موجود بقيمة 1500
- رصيد العلف الافتتاحي = 80 كجم
- محاكاة دفعة hatchery بـ 10 كتاكيت → cost = 15000
- محاكاة صرف 10 كجم علف → الرصيد = 70، التكلفة المضافة للدفعة = 202.38
- BRD-001 + BRD-002 قيمتهم الافتتاحية = 76500 (عند cost_per_bird = 0، نستخدم 1500 fallback في الفرونت)
- مستخدم غير المدير لا يستطيع UPDATE على `brooding_settings`

## التسلسل

1. Migration (settings + feed inventory + movements + triggers + RLS + seed data)
2. تعديل `Brooding.tsx`: hook لجلب settings، كروت جديدة، تبويب إعدادات، تبويب مخزون علف
3. تعديل NewBatchDialog و FeedForm لاستخدام الإعدادات
4. helper الطباعة الجديد + استبدال الاستدعاءات
5. اختبار شامل

## ملاحظات تقنية

- ملف `Brooding.tsx` كبير حالياً (~1500 سطر). سأقسّم التبويبات الجديدة لمكونات فرعية في نفس الملف أو ملفات منفصلة (`BroodingSettingsTab.tsx`, `BroodingFeedInventoryTab.tsx`) للحفاظ على القراءة.
- ستحديث `src/integrations/supabase/types.ts` تلقائياً بعد الـ migration.
- BRD-001 و BRD-002 لن يتم تغيير بياناتهما — fallback في الفرونت يعالج الـ cost_per_bird = 0.
