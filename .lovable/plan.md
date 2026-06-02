# خطة تنفيذ دورة الدبح ← المخازن ← مصنع اللحوم ← تحويل المنتج النهائي

## الوضع الحالي (ملخص فحص الكود)

- ✅ جدول `slaughter_batch_outputs` فيه عمود `destination` (`warehouse` | `meat_factory` | `direct_sale` | `waste` | `branch`).
- ✅ شاشة استلام مصنع اللحوم موجودة (`SlaughterToMeatInbox` + RPC `receive_slaughter_batch_verified`).
- ❌ **لا توجد شاشة استلام للمخزن الرئيسي** لمخرجات الدبح بحالة `destination='warehouse'`. هذه أهم فجوة وراء غياب زر "استلام" الذي أبلغت عنه.
- ✅ مخزن `مخزن خامات مصنع اللحوم` موجود بالفعل (type=`raw_materials`).
- ✅ بنية `warehouse_transfers` + `confirm_transfer_receipt` تدعم تحويل بموافقة.
- ✅ جداول `meat_production_invoices` / `meat_factory_raw_materials` / `meat_factory_products` موجودة لكن شاشة "فاتورة تصنيع" ناقصة الحلقة الكاملة.

## التغييرات المقترحة

### 1) شاشة استلام وارد الدبح للمخزن الرئيسي (الفجوة الأساسية)

ملف جديد: `src/components/warehouse/SlaughterToMainWarehouseInbox.tsx` (مرآة لـ `SlaughterToMeatInbox` لكن بـ `destination='warehouse'`).

- يعرض كل دفعات الدبح المرسلة للمخزن الرئيسي وبانتظار الاستلام.
- زر واضح **"تعديل / استلام"** يفتح Dialog لمراجعة الأوزان والجودة.
- زر تأكيد: **"اعتماد الوارد وإضافة للمخزون"**.
- يستخدم نفس RPC `receive_slaughter_batch_verified` (موسّع ليقبل أي مخزن من نوع `finished_goods` للمنتج اللحمي، أو نضيف RPC مرادف `receive_slaughter_to_warehouse`).
- يدرج حركة في `inventory_movements` بـ `party='المجزر'` و `reference_type='slaughter_receipt'` لظهورها في سجل المخزن.

دمج هذا التبويب داخل صفحة المخزن الرئيسي (`WarehouseDetail` / `Warehouses`) كتبويب "وارد المجزر".

### 2) ضبط تقسيمة الدبح لاختيار الوجهة بوضوح

في `SlaughterBatchDialog` + `Slaughterhouse.tsx`:
- إضافة عمود "الوجهة" لكل سطر تقسيمة: المخزن الرئيسي / مصنع اللحوم.
- التحقق أن مجموع الأوزان لكل وجهة لا يتجاوز الناتج الفعلي.
- عند الحفظ يتم إدراج صفوف `slaughter_batch_outputs` بـ `destination` المناسبة.

### 3) شاشة "فاتورة تصنيع" داخل مصنع اللحوم

ملف جديد: `src/pages/meat/ManufacturingInvoice.tsx` (route: `/meat-factory/manufacturing-invoice/new`).

نموذج الفاتورة:
- المنتج النهائي (من `meat_factory_products` أو من `inventory_items` المصنّفة كمصنّعة).
- الكمية الناتجة، تاريخ التصنيع، الملاحظات، المستخدم (تلقائي).
- جدول الخامات: اختيار من رصيد `مخزن خامات مصنع اللحوم` فقط مع كمية لكل خامة.
- زر "اعتماد الفاتورة" يستدعي RPC جديدة `approve_manufacturing_invoice(p_invoice_id)` التي:
  1. تخصم الخامات من مخزن المصنع (`inventory_movements` out مع `module='meat_factory'`).
  2. تنشئ كمية المنتج النهائي كرصيد داخل مصنع اللحوم (مخزن وسيط `مخزن منتج تام مصنع اللحوم` نضيفه إن لم يوجد، أو نستخدم `meat_factory_products.current_stock`).
  3. تعرّف الفاتورة بحالة `approved` ومجهزة للتحويل.

سجل الفواتير: تبويب يعرض الفواتير السابقة (موجود جزئيًا في `MeatProductionWarehouses`).

### 4) تحويل المنتج النهائي للمخزن الرئيسي بموافقة

- زر داخل فاتورة التصنيع المعتمدة: **"تحويل للمخزن الرئيسي"** يفتح حوار يختار المخزن (افتراضي: المخزن الرئيسي - المقر) ويستدعي RPC `create_and_send_transfer` الموجودة بالفعل.
- يظهر التحويل في شاشة المخزن الرئيسي كـ "وارد بانتظار الاستلام" (تبويب موجود).
- موافقة مسؤول المخزن الرئيسي تستدعي `confirm_transfer_receipt` فيدخل المنتج في الرصيد.
- الحركة في سجل المخزن الرئيسي تظهر بـ `party='مصنع اللحوم'` (نمررها في RPC).

### 5) ضمان وضوح أزرار الاستلام/الاعتماد

مراجعة جميع تبويبات `InboundSupplyTab`/`SlaughterToMeatInbox`/الجديد للتأكد من:
- زر واضح بنص "**اعتماد الوارد**" أو "**استلام**" حسب السياق.
- اللون: برتقالي/أخضر حسب الحالة.
- يظهر فقط للأدوار المخوّلة (`warehouse_supervisor`, `general_manager`, `executive_manager`, `meat_factory_manager`).

## التفاصيل التقنية

- **Migration واحد** يضيف:
  - RPC `receive_slaughter_to_warehouse` (تقبل أي مخزن `finished_goods`).
  - RPC `approve_manufacturing_invoice` (خصم خامات + إضافة منتج تام + تسجيل audit).
  - عمود `source_label` افتراضي في `inventory_movements` ليُضبط من RPC تحويل المنتج النهائي.
  - مخزن جديد `مخزن منتج تام مصنع اللحوم` (type=`finished_goods`) إن وافقت — أو نتعامل مع `meat_factory_products.current_stock` كرصيد منفصل ولا نضيف مخزنًا جديدًا.

- ملفات جديدة:
  - `src/components/warehouse/SlaughterToMainWarehouseInbox.tsx`
  - `src/pages/meat/ManufacturingInvoice.tsx`
  - `src/pages/meat/ManufacturingInvoicesList.tsx`

- ملفات معدّلة:
  - `src/components/slaughterhouse/SlaughterBatchDialog.tsx` + `src/pages/modules/Slaughterhouse.tsx` (اختيار الوجهة).
  - `src/pages/modules/warehouse/WarehouseDetail.tsx` (تبويب وارد المجزر).
  - `src/components/AnimatedRoutes.tsx` + `SidebarMenuSections.tsx` (المسارات الجديدة).

## النشر

- كل تغييرات قاعدة البيانات تنفّذ عبر `supabase--migration` فتصبح live تلقائيًا.
- تعديلات الواجهة الأمامية تتطلب ضغطك على **Publish → Update** بعد الانتهاء لرفعها على `coceg.net`/`naam-alasima.lovable.app`.

## نقاط أحتاج قرار بشأنها قبل البدء

1. هل تفضّل إضافة **مخزن منفصل** لمنتج تام مصنع اللحوم، أم نستخدم رصيد `meat_factory_products.current_stock` الموجود؟
2. هل المنتج النهائي بعد التصنيع يجب أن يظهر في `inventory_items` (كمنتج بيع طبيعي) أم يبقى في `meat_factory_products` فقط حتى التحويل للمخزن الرئيسي؟
3. هل أزل خيار `direct_sale` من وجهات تقسيمة الدبح، أم أبقيه؟