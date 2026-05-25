
# المرحلة 8 — خصم مخزون الطلبات عند التوصيل

## الوضع الحالي (تشخيص)

- يوجد دالة `dispatch_order_stock(order_id)` تخصم من `inventory_items` وتنشئ حركة `sales_dispatch` — لكنها **لا تُستدعى تلقائياً**.
- التريجر `trg_deduct_stock_on_order_item` يخصم فقط من `products.stock` (الحقل القديم) عند إنشاء البند، وليس من `inventory_items`.
- التريجر `trg_handle_order_status_stock` يتعامل فقط مع حالة `cancelled` (إرجاع/خصم `products.stock`).
- النتيجة: **11,708 طلب delivered** كلها `stock_status = not_dispatched` ولم تُخصم من رصيد المخازن.

## المطلوب

عند تحديث حالة الطلب إلى **"تم التوصيل" (delivered)** يتم تلقائياً:
1. خصم الكميات من `inventory_items` للمخزن المصدر.
2. إنشاء حركة `sales_dispatch` لكل بند.
3. تحديث `stock_status = 'dispatched'`.
4. عند التراجع (delivered → غير ذلك) أو الإلغاء: إنشاء حركة `sales_return` تلقائياً وإرجاع الرصيد.

## خطة التنفيذ

### 1) Migration — تعديل تريجر `handle_order_status_stock`

تعديل الدالة لتشمل منطق التوصيل:

```text
IF NEW.status = 'delivered' AND OLD.status <> 'delivered':
    IF stock_status <> 'dispatched' AND source_warehouse_id IS NOT NULL:
        PERFORM dispatch_order_stock(NEW.id)  -- آمن: idempotent
IF OLD.status = 'delivered' AND NEW.status <> 'delivered':
    IF stock_status = 'dispatched':
        PERFORM return_order_stock(NEW.id, 'تراجع عن التوصيل')
```

- استخدام `BEGIN ... EXCEPTION WHEN OTHERS` لتسجيل الخطأ دون منع تحديث الحالة في حالات تشخيصية محددة (أو منعه — يُحدد حسب الرغبة، الافتراض: **منع التحديث** لو فشل الخصم لضمان السلامة).
- بسبب `SECURITY DEFINER` على الدالتين الأصليتين، يجب تمرير `auth.uid()` ضمناً أو إزالة فحص الصلاحية داخل التريجر (سيتم استخدام `SECURITY DEFINER` على دالة التريجر نفسها مع تجاوز فحص الدور لأن السماح بتحديث الحالة تم بالفعل عبر RLS على `orders`).

### 2) الحماية من الخصم بأثر رجعي

- **لن تُلمس** أي من الـ 11,708 طلب التاريخية. التريجر يعمل فقط على `UPDATE` يغير `status` إلى delivered. الطلبات القديمة `stock_status = not_dispatched` ستبقى كما هي.
- اختياري: تحديث `stock_status` للطلبات التاريخية إلى قيمة جديدة `legacy_not_dispatched` لتمييزها، لكن **لا يُنفّذ في هذه المرحلة** حفاظاً على عدم تغيير البيانات.

### 3) UI

- لا تغيير في الواجهة. زر تحديث الحالة في `Orders.tsx` و `OrderDetails.tsx` يستمر كما هو، والخصم يحدث تلقائياً عبر التريجر.
- في حال فشل الخصم (نقص رصيد/مخزن مصدر غير محدد) → سيظهر رسالة الخطأ من supabase في toast تلقائياً، ولن تتغير حالة الطلب.

### 4) اختبارات يدوية مطلوبة بعد التطبيق

1. إنشاء طلب جديد بمنتج واحد كمية صغيرة من مخزن العجوزة.
2. التحقق من `inventory_items.stock` قبل التوصيل.
3. تحديث حالة الطلب إلى delivered.
4. التحقق من:
   - نقصان `inventory_items.stock` بالكمية الصحيحة.
   - وجود حركة `sales_dispatch` جديدة في `inventory_movements`.
   - `orders.stock_status = 'dispatched'`.
5. تجربة طلب بدون رصيد كافٍ → يجب أن يفشل تحديث الحالة مع رسالة واضحة.
6. تجربة تحويل من delivered → shipped → التأكد من إنشاء حركة `sales_return` وإرجاع الرصيد.

## ما لن يتم تنفيذه

- لن يتم تعديل `deduct_stock_on_order_item` (يبقى يخصم من `products.stock` للتوافق العكسي).
- لن يتم تعديل الطلبات التاريخية.
- لن يتم تغيير الواجهة.

## تأكيد قبل التنفيذ

أحتاج موافقتك قبل تشغيل الـ migration.
