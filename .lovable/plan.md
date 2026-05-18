## الهدف
تحويل "قائمة التصنيع" إلى مصدر تلقائي لأوامر الإنتاج التي تُرسَل مباشرة لقسم المجزر أو قسم مصنع اللحوم بناءً على العجز بين رصيد المخزن والطلبات اليومية.

## ما الذي سيتغير

### 1) جدول جديد: `production_dispatch_orders`
بدلاً من الكتابة مباشرة في `slaughter_batches` (التي تتطلب live receipts) أو `meat_factory_batches` (التي تتطلب source_invoice/recipe)، ننشئ جدولاً وسيطًا للأوامر المُحوَّلة:

- `product_id`, `product_name`, `unit`
- `required_qty` (= العجز)
- `current_stock`, `pending_qty` (لقطة وقت الإرسال)
- `destination` (`slaughterhouse` | `meat_factory`)
- `priority` (`critical|high|medium|low`)
- `status` (`new|accepted|in_progress|completed|cancelled`)
- `affected_orders` jsonb (أرقام الطلبات المتأثرة)
- `notes`, `created_by`, `created_by_name`, `accepted_by`, `accepted_at`, `completed_at`
- RLS:
  - إنشاء: general/executive/sales/production manager + warehouse_supervisor
  - عرض/تحديث slaughterhouse: general/executive/production + slaughterhouse_manager + warehouse_supervisor
  - عرض/تحديث meat_factory: general/executive/production + meat_factory_manager + warehouse_supervisor

### 2) صفحة "قائمة التصنيع" — أزرار إرسال
لكل صف فيه عجز:
- زر **"إرسال للمجزر"** + زر **"إرسال لمصنع اللحوم"** (يفتح Dialog لتأكيد الكمية والوجهة وملاحظة).
- زر علوي **"إرسال كل العجز تلقائيًا"**:
  - يصنّف المنتج تلقائيًا حسب الاسم (افتراضي قابل للتجاوز):
    - يحتوي "نعامة/فخدة/نص نعامة/ذبيحة/كاملة/طازج" ⇒ `slaughterhouse`
    - باقي القطعيات (كباب/كفتة/برجر/استيك/شيش/تربيانكو/اسكالوب/رول/سجق/...) ⇒ `meat_factory`
    - بيض ⇒ يتم تخطّيه (لا ينتمي لأي منهما) مع تنبيه.
  - يفتح Dialog مراجعة قبل الإرسال يسمح بتغيير الوجهة لكل صف.
- يعرض شارة صغيرة بجوار كل صف إن كان عليه أمر إنتاج مفتوح حاليًا.

### 3) صندوق وارد داخل صفحتي القسمين
- في `/modules/slaughterhouse` و `/modules/meat-factory` نضيف كرت أعلى الصفحة:
  - "أوامر إنتاج واردة من المبيعات" — قائمة بالأوامر الجديدة (new/accepted) مع: الصنف، الكمية المطلوبة، الأولوية، الطلبات المرتبطة، تاريخ الإرسال.
  - أزرار: "قبول" → status=accepted، "بدء" → in_progress، "إكمال" → completed، "رفض/إلغاء" → cancelled (مع سبب).

### 4) إشعارات
عند إنشاء أمر:
- إدخال صف في `notifications` بعنوان "أمر إنتاج جديد للمجزر/مصنع اللحوم" يحتوي الصنف والكمية.

## ملاحظات تقنية
- لا نتدخّل في schemas `slaughter_batches` و `meat_factory_batches` الحالية؛ يبقى المسؤول هو من يحوّل الأمر إلى دفعة فعلية داخل قسمه.
- التصنيف الافتراضي يحفظ في ملف ثابت `src/constants/productRouting.ts` ليسهل تعديله لاحقًا.
- لا تكرار: قبل الإرسال نتحقق من وجود أمر مفتوح لنفس المنتج بنفس الوجهة وحالته ليست completed/cancelled — لو موجود نُحدِّث الكمية بدلاً من إنشاء صف جديد.

هل أبدأ التنفيذ بهذه الخطوات؟