# خطة: Opening Balance + ضبط حركات المخزن الرئيسي

## ١. تثبيت الأرصدة الحالية كـ Opening Balance

- إنشاء snapshot لكل أصناف المخزن الرئيسي بقيمها الحالية في `inventory_items.stock` في جدول جديد `warehouse_opening_balances` (warehouse_id, item_id, qty, opened_at, opened_by, notes).
- تسجيل حركة افتتاحية في `inventory_movements` نوعها `opening_balance` لكل صنف، عشان سجل الحركات يبدأ من نقطة صفر واضحة.
- **إيقاف** أي تريجر قديم بيعمل double deduction (شفناهم في التحقيق السابق): حذف التريجر المكرر `trg_order_item_insert` والإبقاء على `trg_deduct_stock_on_order_item` فقط مع تعديل سلوكه (الخطوة ٣).

## ٢. حركات الوارد المعتمدة فقط للمخزن الرئيسي

أي زيادة بعد اللحظة دي لازم تمر بحركة موثقة. مصادر الزيادة المسموحة:

| المصدر | كيفية الإدخال |
|---|---|
| دبح المجزر | شاشة "توريد دبح → مخزن رئيسي" (موجودة جزئياً في `SlaughterBatchDialog` / Inbox) — عند الاعتماد: `inventory_movements.movement_type='in'`, `reference_type='slaughter_batch'`, `source='الدبح'` + زيادة `inventory_items.stock` |
| مصنع اللحوم | شاشة "توريد إنتاج مصنع → مخزن رئيسي" (`MeatCostApprovalPanel` بعد الاعتماد) — `reference_type='meat_batch'`, `source='مصنع اللحوم'` |
| مرتجعات Healthy Taste / كارفور / العجوزة | حركة `in` بـ `source='مرتجع <جهة>'` |
| تعديل جرد المدير | `movement_type='adjust'` + سبب إلزامي + `performed_by` |

كل حركة تكتب: التاريخ، الصنف، الكمية، النوع، المصدر، `performed_by` (اسم المستخدم)، ملاحظات.

## ٣. حركات الصادر (تأكيد المنطق الصحيح)

- **طلبات المودريتور بمصدر الرئيسي**: حجز فقط (محسوب من `order_items` على الـ fly) — **لا** تخصم من `stock`.
- **عند `stock_status='dispatched'` أو `status='delivered'`**: تريجر يخصم من `stock` ويسجل `movement_type='out'`, `reference_type='order'`, `source='صرف طلب'`.
- **إلغاء**: لا حركة، يخرج من المحجوز فقط.
- **تحويل لمخزن العجوزة**: حركة `transfer` (موجودة).
- **بيع مباشر / قنوات أخرى**: حركة `out` بمصدر واضح.

## ٤. شاشة سجل حركات المخزن الرئيسي

تحسين `MainWarehouseActivity.tsx` الموجودة:
- إضافة عمود **المستخدم المنفذ** (join على `profiles` عبر `performed_by`).
- إضافة عمود **المصدر/النوع التفصيلي** (دبح / مصنع لحوم / مرتجع / صرف طلب / تحويل / جرد).
- فلتر حسب نوع المصدر (Source category).
- إظهار صف "رصيد افتتاحي" بتاريخ التثبيت بلون مميز.

## ٥. شاشة عرض الرصيد (`WarehouseStockView` scope=main)

- إضافة كارت أعلى الجدول يعرض تاريخ Opening Balance الحالي.
- زر "تعديل جرد" بصلاحية المدير العام/التنفيذي فقط، يفتح Dialog يطلب: الكمية الجديدة + سبب → يكتب حركة `adjust` ويحدث `stock`.

## ٦. ملخص تقني

**Migration واحدة:**
1. إنشاء جدول `warehouse_opening_balances`.
2. Insert snapshot من `inventory_items` للمخزن الرئيسي.
3. Insert حركات `opening_balance` في `inventory_movements`.
4. حذف التريجر المكرر `trg_order_item_insert`.
5. تعديل `deduct_stock_on_order_item`: ما يخصمش من `stock` على INSERT (يكتفي بالحجز عبر الحساب من `order_items`). الخصم يحصل فقط من تريجر `handle_order_status_stock` لما `stock_status='dispatched'` أو `status='delivered'`.
6. تنظيف `handle_order_item_update` / `handle_order_item_delete` عشان يلمسوا `inventory_items.stock` بدل `products.stock` فقط لما الطلب يكون متخصم فعلاً (dispatched/delivered).

**ملفات Frontend:**
- `src/pages/MainWarehouseActivity.tsx` — إضافة المستخدم وفلتر المصدر.
- `src/pages/WarehouseStockView.tsx` — كارت Opening Balance + زر تعديل جرد للمدير.
- إنشاء `src/components/warehouse/AdjustStockDialog.tsx`.

**لا migration لبيانات تاريخية**: الأرصدة الحالية في `inventory_items.stock` هي المرجع. كل اللي قبل تاريخ التثبيت يتجاهل لأغراض الحساب الجديد (لكن يفضل ظاهر في السجل التاريخي للمراجعة).

## خارج النطاق
- إعادة معالجة الحركات التاريخية بأثر رجعي.
- تنبيهات عند المتاح ≤ 0 (ممكن في خطوة لاحقة).
