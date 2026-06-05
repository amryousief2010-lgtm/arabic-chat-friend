# خطة تطوير إدارة المجزر

سأبني على الجداول الموجودة (`slaughter_batches`, `slaughter_batch_outputs`, `slaughter_branch_transfers`, `slaughter_workers`, `slaughter_live_receipts`, `inventory_movements`, `meat_raw_inventory`, `inventory_items`) بدون كسر بيانات.

## 1) داشبورد المجزر `/slaughterhouse/dashboard`
KPIs حقيقية محسوبة من قاعدة البيانات:
- النعام القائم الحالي = SUM(slaughter_live_birds.current_count)
- مذبوح الشهر / اليوم = SUM(birds_slaughtered) فلتر بـ cairoMonthStartUTC / cairoTodayStartUTC على slaughter_date
- الوزن الحي اليوم / الشهر = SUM(total_live_weight_kg)
- وزن اللحم المشفى = SUM(total_meat_kg)
- نسبة التصافي = total_meat_kg / total_live_weight_kg × 100
- إنتاج الشهر (كجم) + تكلفة الكيلو (متوسط cost_per_kg_meat)
- عدد أوامر الإنتاج الواردة (production_dispatch_orders.status='pending')
- إجمالي تحويلات المجزر → المخزن الرئيسي / مصنع اللحوم (من slaughter_branch_transfers + inventory_movements)

تقسيم واضح: حي / بعد ذبح / مشفى / هالك / منتجات التقسيمة.

## 2) جدول عمال المجزر (جزارين)
استخدام `slaughter_workers` الموجود. إدخال ٣ سجلات:
- محمود جمال — جزار مسؤول أول
- حمدي حماد — جزار مسؤول ثاني
- إبراهيم السعدني — جزار مسؤول ثالث

إضافة أعمدة لـ `slaughter_batches`:
- `butcher_1_id uuid`, `butcher_2_id uuid`, `butcher_3_id uuid` (FK → slaughter_workers)
عرضهم في تفاصيل أمر الذبح + الطباعة + التقارير.

## 3) تجربة تقسيمة دبح نعام كاملة
داخل `SlaughterBatchDialog` (موجود):
1. إنشاء batch جديد (طيور + وزن حي + اختيار ٣ جزارين).
2. تسجيل ناتج التقسيمة في `slaughter_batch_outputs` (موزة، استيك، لحم قطع، إلخ).
3. اختيار وجهة كل سطر: `main_warehouse` أو `meat_factory`.
4. زر "اعتماد + ترحيل":
   - يُنشئ `slaughter_branch_transfers` (سطر/سطور) **بـ status='pending'**.
   - يُنشئ `inventory_movements` بنوع `transfer_out` من المجزر، و`transfer_in` بانتظار الاستلام على المخزن المستهدف.
   - يحدّث `inventory_items.stock` فقط عند **الاستلام** (ليس عند الإرسال) لتجنب الخصم/الإضافة المزدوجة.
5. حماية idempotency: UNIQUE على (output_id, branch_id, status<>'cancelled') + فحص داخل RPC قبل الإدراج.

RPC جديد: `slaughter_dispatch_outputs(p_batch_id, p_lines jsonb)` يعمل كل ما سبق في معاملة واحدة.

RPC جديد: `slaughter_transfer_receive(p_transfer_id, p_accepted_kg, p_rejected_kg, p_reason)` للاستلام في الطرف الآخر — يُحدّث `inventory_items.stock` ويُنشئ حركة `transfer_in` نهائية.

## 4) سجل نقل اللحوم `/slaughterhouse/transfers-log`
View جديد `v_slaughter_transfer_shipments` يجمع التحويلات في **شحنة واحدة لكل صف** (group by batch_id + transferred_at + destination):
أعمدة: رقم الحركة، التاريخ، أمر الذبح، المرسل (المجزر)، المستلم (المخزن الرئيسي / مصنع اللحوم)، إجمالي كجم، عدد الأصناف، الحالة، المُنشئ، وقت الإنشاء، وقت الاستلام، ملاحظات.

## 5) زر العين — تفاصيل النقلة
Dialog يعرض:
- بيانات الحركة + قائمة الأصناف (الكمية، الوحدة، المقبول، المرفوض، سبب الرفض)
- المخزن المستلم + أسماء الجزارين + ملاحظات

## 6) طباعة / Excel / PDF
- زر طباعة + PDF عبر `openPrintWindow` من `@/lib/printPdf` (Arabic-safe)
- زر Excel عبر `safeExcel`
- شكل "إذن نقل لحوم من المجزر": شعار، رقم، تاريخ، أمر الذبح، المستلم، جدول، إجمالي، أسماء الجزارين، توقيع مسلم/مستلم، ملاحظات.

## التغييرات على قاعدة البيانات (Migration واحدة)
```text
ALTER slaughter_batches ADD butcher_1_id, butcher_2_id, butcher_3_id
INSERT 3 workers في slaughter_workers (لو غير موجودين)
CREATE OR REPLACE VIEW v_slaughter_transfer_shipments
CREATE FUNCTION slaughter_dispatch_outputs(...)
CREATE FUNCTION slaughter_transfer_receive(...)
CREATE UNIQUE INDEX جزئي لمنع الازدواج
```
**بدون أي حذف للبيانات**. الحركات القديمة تبقى كما هي.

## التغييرات في الكود
- `src/pages/modules/Slaughterhouse.tsx` — داشبورد جديدة بالـ KPIs المطلوبة
- `src/components/slaughterhouse/SlaughterBatchDialog.tsx` — اختيار ٣ جزارين + اختيار وجهة لكل ناتج + زر "اعتماد وترحيل"
- `src/pages/slaughterhouse/TransfersLog.tsx` — جدول السجل + بحث/فلتر
- `src/components/slaughterhouse/TransferDetailsDialog.tsx` — تفاصيل + طباعة + PDF + Excel
- `src/components/slaughterhouse/SlaughterTransferPrint.tsx` — قالب الطباعة
- استدعاء RPC الاستلام من شاشات المخزن الرئيسي ومصنع اللحوم (Inbox الموجود)

## اختبار حقيقي (مطلوب من المستخدم)
بعد التطبيق سأنفّذ Seed تجريبي: batch نعام، ٣ منتجات (لحم قطع/موزة/قلوب)، نُرسل جزء للمخزن الرئيسي وجزء لمصنع اللحوم، نستلم، ونتأكد أن:
- inventory_items.stock تحدّثت مرة واحدة فقط
- slaughter_branch_transfers status = 'received'
- تظهر في سجل النقل المجمّع
- لا توجد حركة مكررة

## شروط محفوظة
- لا تغيير على منطق الطلبات أو مخزون باقي النظام
- لا حذف بيانات
- استخدام cairoDate helpers لكل الفلاتر الزمنية
- جميع الحركات تمر عبر `inventory_movements`

هل أبدأ التنفيذ؟
