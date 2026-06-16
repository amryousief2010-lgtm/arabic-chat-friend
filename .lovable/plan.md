# خطة: دورة تكلفة النعام الجاهز للدبح

ميزة كبيرة متعددة الطبقات تربط مخزن علف المجزر بدفعات النعام الحي، ثم بتقسيمة الذبح، ثم بتكلفة المنتجات الناتجة. سأنفذها على مراحل قابلة للاختبار.

---

## 1) قاعدة البيانات (Migration واحدة)

### تعديلات على جداول قائمة
- `slaughter_live_receipts` (دفعات النعام الحي الجاهز للدبح): إضافة
  - `original_count` (عدد أصلي), `current_alive_count`, `mortality_count`
  - `original_cost_total` (تكلفة شراء/استلام النعام)
  - `feed_cost_loaded` (إجمالي تكلفة العلف المحملة)
  - `mortality_cost_loaded` (تكلفة النافق المحملة على الباقي)
  - `other_costs_loaded`
  - `total_batch_cost` (محسوب)
  - `cost_per_bird_current` (محسوب = total / current_alive)
- `slaughter_batches` (دفعة الذبح): إضافة
  - `source_live_batch_id` → `slaughter_live_receipts.id`
  - `birds_in_count`, `cost_per_bird_snapshot`, `total_birds_cost`
  - `direct_slaughter_expenses`, `total_allocatable_cost`
  - `cost_allocation_done` boolean + `cost_allocation_ref` نص فريد

### جداول جديدة
1. `slaughter_ostrich_feed_consumption`
   - `id`, `consumption_date`, `live_batch_id` (FK), `feed_item_id` (FK → slaughterhouse_feed_inventory), `feed_type`, `quantity_kg`, `birds_count_at_time`, `unit_cost`, `total_cost`, `stock_before`, `stock_after`, `responsible_user_id`, `notes`, `reference_id` UNIQUE, `reversed_by`, `reversal_reason`, `created_by`, `created_at`
2. `slaughter_live_mortality`
   - `id`, `live_batch_id` (FK), `mortality_date`, `dead_count`, `reason`, `cost_per_bird_before`, `total_loss_cost`, `load_on_remaining` boolean default true, `notes`, `reference_id` UNIQUE, `reversed_by`, `reversal_reason`, `created_by`, `created_at`
3. `slaughter_batch_cost_breakdown` (لقطة تكلفة وقت تقسيمة الذبح — قراءة فقط للتاريخ)
   - `slaughter_batch_id` PK, `birds_count`, `birds_original_cost`, `feed_cost`, `mortality_cost`, `other_costs`, `direct_expenses`, `total_cost`, `total_output_kg`, `cost_per_kg`, `created_at`

### دوال SQL
- `recalc_live_batch_cost(p_live_batch_id uuid)` — يحسب الإجماليات ويحدّث الدفعة (يستدعى من triggers بعد كل صرف علف / نفوق).
- `apply_slaughter_cost_allocation(p_slaughter_batch_id uuid)` — يحفظ snapshot في `slaughter_batch_cost_breakdown` ويحدّث `unit_cost` لكل `slaughter_batch_outputs` بالقسمة على الكيلو الناتج. مع reference_id لمنع التكرار.

### Triggers
- بعد INSERT على `slaughter_ostrich_feed_consumption`:
  - خصم من `slaughterhouse_feed_inventory` (مع حفظ stock_before/after)
  - تسجيل حركة في `slaughterhouse_feed_movements` بنوع `slaughter_ostrich_feed_consumption`
  - استدعاء `recalc_live_batch_cost`
- بعد INSERT على `slaughter_live_mortality`: تحديث `mortality_count`, `current_alive_count`, ثم `recalc_live_batch_cost`.

### GRANT + RLS
- جداول مرتبطة بالمجزر → نفس نمط `slaughter_*` الحالية: قراءة/كتابة للأدوار `slaughterhouse_manager`, `general_manager`, `executive_manager`, مع منع DELETE (عكس بحركة عكسية).

---

## 2) الواجهة (Frontend)

### A. صفحة مخزن علف المجزر
زر جديد بارز: **"صرف علف للنعام"** يفتح Dialog (`SlaughterOstrichFeedConsumptionDialog.tsx`) بالحقول المطلوبة. بعد الحفظ: refresh للمخزون والحركات.

### B. صفحة دفعات النعام الحي
- أعمدة جديدة: الأصلي / الحي / النافق / تكلفة العلف / تكلفة النافق / تكلفة النعامة الحالية.
- زر **"تسجيل نفوق"** لكل صف → Dialog `LiveBatchMortalityDialog.tsx`.
- زر **"تفاصيل التكلفة"** يعرض الـ breakdown.

### C. شاشة تقسيمة الذبح (`SlaughterBatchDialog.tsx`)
- اختيار دفعة المصدر `source_live_batch_id`.
- عند اختيار الدفعة + إدخال عدد النعام، يعرض panel معاينة:
  - تكلفة النعامة الفعلية × العدد = إجمالي تكلفة النعام الداخل للدبح
  - + مصروفات ذبح مباشرة = إجمالي القابل للتوزيع
- بعد حفظ نواتج الذبح: استدعاء `apply_slaughter_cost_allocation` لتعبئة `unit_cost`.

### D. تقريران جديدان
- `/modules/slaughterhouse/live-batch-costs` — تكلفة النعام الجاهز للدبح.
- `/modules/slaughterhouse/ostrich-feed-log` — سجل صرف علف النعام.

روابط في السايد بار تحت قسم المجزر.

---

## 3) منع التكرار (Idempotency)
- `reference_id` فريد على كل من: صرف علف، نفوق، توزيع تكلفة الذبح. أي محاولة تكرار → رسالة "تم تسجيل هذه الحركة من قبل".

---

## 4) الصلاحيات
- INSERT: `slaughterhouse_manager` + GM/Executive.
- UPDATE/Reverse: GM/Executive فقط (حركة عكسية بسبب).
- DELETE: ممنوع على مستوى RLS.

---

## 5) ربط بربحية المنتجات والميزانية
- `productCostMap` في تقرير الربحية يقرأ بالفعل `unit_cost` من `slaughter_batch_outputs` — هذا التحديث يجعل القيمة دقيقة تلقائيًا.
- Edge function `department-monthly-budget`: نضيف بند **تكلفة العلف على النعام** و**تكلفة النافق** للمجزر من الجدولين الجديدين بدل/بجانب الحساب الحالي.

---

## 6) الاختبار اليدوي بعد التنفيذ
السيناريو الكامل المذكور في الطلب (دفعة 10 نعام → صرف علف → نفوق → تقسيمة لـ 3 → نواتج → ربحية).

---

## ملف ملاحظات تقني
- لن نلمس `auth`, `storage`, `slaughter_custody_*` (الخزنة منفصلة تمامًا).
- صرف العلف لا ينشئ حركة خزنة — فقط حركة مخزون + تحميل تكلفة.
- كل دوال SQL `SECURITY DEFINER` + `SET search_path = public`.
- استخدام `cairoDate` للتواريخ في التقارير الشهرية.

---

موافقتك على هذه الخطة تبدأ التنفيذ بمايجريشن واحدة شاملة ثم الواجهات تباعًا.