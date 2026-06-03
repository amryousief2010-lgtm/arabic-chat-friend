# خطة تعديل قسم التحضين والتسمين

سأقسم العمل إلى 7 محاور رئيسية مع تعديلات قاعدة البيانات وواجهة المستخدم.

## 1. فاتورة بيع الكتاكيت حسب العمر

**قاعدة البيانات (`brooding_chick_sales`):**
- إضافة `age_at_sale_days` (int)
- إضافة `age_label_snapshot` (text) — مثل "عمر شهر"
- إضافة `cost_per_bird_at_sale` (numeric) — Snapshot وقت البيع
- إضافة `total_cost_snapshot` (numeric) = العدد × cost_per_bird_at_sale
- إضافة `profit_loss` (numeric) = sale_total - total_cost_snapshot

**Trigger:**
- قبل INSERT: التحقق أن `chicks_sold <= current_count` للدفعة
- بعد INSERT: خصم العدد من `current_count` + تسجيل movement من نوع `chicks_sale`
- snapshot التكلفة والعمر تلقائيًا من الدفعة وقت البيع

**واجهة (Brooding.tsx — حوار بيع كتاكيت):**
- اختيار الدفعة → عرض العمر الحالي والتكلفة الحالية تلقائيًا
- Select لـ "عمر الكتاكيت وقت البيع": أسبوع / أسبوعين / شهر / شهر ونص / شهرين / **العمر الحالي تلقائيًا** / **يدوي (للمدير فقط)**
- عرض حساب فوري: قيمة البيع - التكلفة = ربح/خسارة
- Validation: لا يسمح بعدد أكبر من current_count

## 2. سبب النافق إجباري

**قاعدة البيانات (`brooding_mortality`):**
- جعل `reason` NOT NULL + CHECK length > 3
- Trigger validation للنصوص الفارغة فقط

**واجهة:**
- جعل حقل السبب required مع رسالة واضحة
- Zod validation: `reason: z.string().trim().min(3, "يجب كتابة سبب النافق")`

## 3. صرف العلف: خصم من مخزون + إشعار + إذن طباعة

**قاعدة البيانات:**
- جدول `chick_feed_stock` (إن لم يوجد) — رصيد علف الكتاكيت
- جدول `chick_feed_movements` — IN/OUT مع `unit_cost_snapshot` و `source` (purchase / feed_factory / adjustment)
- Trigger على صرف العلف للدفعة:
  - يخصم من `chick_feed_stock`
  - يضيف movement OUT بـ `unit_cost_snapshot` = سعر التكلفة الحالي
  - ينشئ notification لمحمد خالد (مسؤول مصنع الأعلاف) في جدول `notifications`

**واجهة:**
- زر "إذن صرف علف" يفتح `openPrintWindow` (من `@/lib/printPdf`) بكل التفاصيل المطلوبة وتوقيعين
- بعد الصرف: toast + إشعار تلقائي يظهر في bell icon لمحمد خالد

## 4. شاشة تركيبة علف التسمين

**قاعدة البيانات:**
- جدول `feed_recipes` (موجود في `feed/Recipes.tsx`) — أتأكد من وجود حقول: name, phase (age_from_days, age_to_days), is_active, computed cost_per_kg, cost_per_ton
- جدول `feed_recipe_ingredients` — name, quantity_kg, unit_price
- إضافة المرحلة العمرية + استيراد التركيبة من ملف Excel المرفق سابقًا

**واجهة (Brooding.tsx tab جديد "تركيبة علف التسمين"):**
- جدول تركيبات مع زر إضافة/تعديل (للمدير العام/التنفيذي فقط)
- حساب فوري لتكلفة الطن/الكيلو عند تعديل الكميات أو الأسعار
- عند صرف علف لدفعة: استخدام `cost_per_kg` الحالي للتركيبة المناسبة للعمر
- **القديم لا يتغير**: movements تحفظ `unit_cost_snapshot` لحظة الصرف

## 5. العلف من مصنع الأعلاف بسعر التكلفة

- في trigger صرف العلف: استخدام `recipe.cost_per_kg` (تكلفة) وليس `feed_product.sale_price`
- إضافة عمود `source = 'feed_factory'` في movement
- العرض في تفاصيل الدفعة: "مصدر العلف: مصنع الأعلاف | سعر الكيلو تكلفة: X"

## 6. التحويل للمجزر مع الوزن القائم

**قاعدة البيانات (`brooding_slaughter_transfers` أو ما يماثلها):**
- إضافة: `birds_count`, `total_live_weight_kg`, `avg_live_weight_kg` (computed), `live_price_per_kg`, `transferred_cost_per_bird` (snapshot), `total_transfer_cost` (computed), `valuation_amount` (= total_live_weight × live_price), `expected_profit_loss` (computed)

**واجهة:**
- حوار التحويل للمجزر يطلب: العدد، إجمالي الوزن القائم، سعر الكيلو قائم
- عرض الحسابات تلقائيًا قبل التأكيد
- بعد التأكيد: خصم العدد من الدفعة + إنشاء سجل في المجزر `slaughter_live_stock` (in)

## 7. التنفيذ التقني

سيتم تنفيذها على دفعات Migration:
1. **Migration 1**: تعديل `brooding_chick_sales` + trigger البيع + التحقق من العدد
2. **Migration 2**: `brooding_mortality.reason NOT NULL` + validation trigger
3. **Migration 3**: `chick_feed_stock` + `chick_feed_movements` + trigger الإشعار لمحمد خالد
4. **Migration 4**: `feed_recipes` (تأكد/تعديل) + ingredients + بذر تركيبة Excel
5. **Migration 5**: `brooding_slaughter_transfers` بحقول الوزن القائم

ثم تعديلات `src/pages/modules/Brooding.tsx` لإضافة:
- حوار بيع كتاكيت محدّث مع اختيار العمر
- حوار تسجيل نافق مع validation
- حوار صرف علف + زر إذن طباعة
- Tab "تركيبة علف التسمين"
- حوار التحويل للمجزر مع الوزن القائم

## ملاحظات

- كل العمليات الحسابية الحرجة (snapshot التكلفة، خصم المخزون، الإشعارات) تتم في **DB triggers** لضمان الدقة وعدم التحايل من الـ UI.
- الطباعة عبر `openPrintWindow` من `@/lib/printPdf` لضمان دعم العربية (مذكور في memory).
- صلاحيات التعديل في التركيبات: `general_manager` أو `executive_manager` فقط (تحقق في الـ UI + RLS policy).
- الإشعار لمحمد خالد: نحتاج الـ user_id الخاص به — سأبحث عنه أولًا في profiles قبل كتابة الـ trigger، أو نستخدم الدور `feed_factory_manager`.

هل أمضي بالتنفيذ؟
