# خطة نظام معمل التفريخ والحضانات

## 1. قاعدة البيانات (Migration واحدة)

### جدول الإعدادات `hatchery_pricing_settings` (صف واحد)
- `infertile_egg_price` (افتراضي 50)
- `chick_price` (افتراضي 150)
- `completed_unhatched_price` (افتراضي 100)
- `daily_brooding_price` (افتراضي 15)
- `candling_day` (افتراضي 15)
- `transfer_to_hatcher_day` (افتراضي 39)
- `hatcher_duration_hours` (افتراضي 24)

### جدول `hatchery_batches`
- `batch_number` (تلقائي), `entry_date`, `batch_type` (`internal` | `external` | `mixed`), `incubator_machine_no`, `notes`, `status` (`incubating` | `candled` | `in_hatcher` | `in_brooding` | `closed` | `cancelled`), `created_by`
- حقول مجمعة محسوبة: `total_eggs_in`, `candle_date`, `hatcher_date`

### جدول `hatchery_batch_lots` (كل عميل/مصدر داخل الدفعة)
- `batch_id`, `owner_type` (`capital_ostrich` | `external_client`), `client_id` (nullable → جدول `hatch_customers` الحالي)
- `source` (`mother_farm` | `external`), `eggs_in`
- نتائج الكشف: `infertile_eggs`, `infertile_edible`, `infertile_inedible`, `fertile_eggs`, `candling_notes`, `candling_recorded_at`, `candling_by`
- نتائج الهاتشر: `chicks_hatched`, `completed_unhatched`, `hatcher_out_at`, `hatcher_out_by`, `hatcher_machine_no`
- الحضانات: `brooding_in_at`, `brooding_out_at`, `brooding_days` (محسوب أو يدوي عند الخروج)
- الفوترة: `invoice_id` (nullable)

### جدول `hatchery_batch_movements`
سجل كل عملية: `batch_id`, `lot_id`, `event_type` (`created` | `candling` | `transferred_to_hatcher` | `hatched` | `moved_to_brooding` | `delivered` | `cancelled`), `payload` jsonb, `created_by`, `created_at`

### جدول `hatchery_client_invoices`
- `invoice_no`, `client_id`, `batch_id`, `lot_id`
- `eggs_in`, `infertile_count`, `infertile_amount`
- `chicks_count`, `chicks_amount`
- `completed_unhatched_count`, `completed_unhatched_amount`
- `brooding_chicks_count`, `brooding_days`, `brooding_daily_price`, `brooding_amount`
- `total_amount`, `paid_amount`, `remaining_amount` (محسوب), `payment_status`
- `notes`, `issued_at`, `issued_by`

### جدول `hatchery_invoice_payments`
- `invoice_id`, `amount`, `paid_at`, `method`, `notes`, `received_by`

### Views
- `v_hatchery_dashboard_kpis` — كروت الداشبورد
- `v_hatchery_client_balances` — مديونية كل عميل
- `v_hatchery_batches_full` — كل دفعة مع تواريخ الكشف والهاتشر والحالة

### Functions
- `compute_hatchery_invoice(lot_id)` — تحسب القيم وفق الإعدادات الحالية وتنشئ/تحدث الفاتورة
- `cancel_hatchery_batch(batch_id, reason)` — إلغاء بدلاً من حذف

### RLS & GRANT
- العرض: كل المستخدمين المسجلين
- التعديل (دفعات/كشف/نقل/فواتير/إعدادات): `general_manager`, `executive_manager`, `hatchery_supervisor`
- المدفوعات + قراءة الفواتير: نفس الأدوار + `accountant`

## 2. الواجهة

ملف جديد `src/pages/modules/HatcheryLab.tsx` بتبويبات:

1. **داشبورد** — كروت (إجمالي البيض الحالي، عاصمة، عملاء، تنتظر كشف، تنتظر هاتشر، في الهاتشر، في الحضانات، كتاكيت الشهر، نسبة الفقس، إجمالي الفواتير/المدفوع/المتبقي) + بانر تنبيهات الدفعات التي وصلت اليوم 15 أو 39.
2. **الدفعات** — جدول كل الدفعات مع الحالة وأيام العمر، أزرار: تسجيل كشف، نقل للهاتشر، تسجيل الفقس، نقل للحضانات، تسليم، إلغاء.
3. **دفعة جديدة** — ديالوج: تاريخ، رقم ماكينة، نوع، ملاحظات، + إضافة Lots متعددة (نعام العاصمة / عميل خارجي + عدد البيض + المصدر).
4. **فواتير العملاء** — جدول الفواتير + تفاصيل + إضافة دفعة سداد + طباعة/PDF/Excel.
5. **مديونية العملاء** — جدول إجمالي لكل عميل (فواتير، مدفوع، متبقي).
6. **الإعدادات** — تعديل أسعار البيضة اللايح/الكتكوت/أكمل ولم يفقس/التحضين اليومي + أيام الكشف والهاتشر (للأدوار المصرح لها فقط).

ديالوجات منفصلة:
- `CandlingDialog` — لكل lot: عدد اللايح (صالح/غير صالح للأكل) + المخصب + ملاحظات.
- `TransferToHatcherDialog` — رقم ماكينة الهاتشر + الكمية المنقولة + الوقت.
- `HatchResultDialog` — لكل lot: عدد الكتاكيت + أكمل ولم يفقس.
- `MoveToBroodingDialog` / `DeliverFromBroodingDialog`.
- `PaymentDialog` و`InvoicePrintView` يستخدم `openPrintWindow` من `@/lib/printPdf` لدعم العربية.

تكامل مع السايد بار: إضافة بند "معمل التفريخ" تحت قسم المزرعة (يستبدل أي صفحات تفريخ قديمة بدون حذفها من الكود).

## 3. الفوترة التلقائية

عند تسجيل الكشف → تنشأ/تحدث الفاتورة للـ external lots بقيمة `infertile_amount` فقط.
عند تسجيل الفقس → تضاف `chicks_amount` + `completed_unhatched_amount`.
عند تسليم الكتاكيت من الحضانات → يحسب `brooding_days = brooding_out - hatcher_out` ويضاف `brooding_amount` ويقفل المبلغ النهائي.
- بيض نعام العاصمة لا تنشأ له فاتورة.

## 4. التنبيهات

- فحص يومي عند فتح الداشبورد: أي batch بلغ `entry_date + candling_day` ولم يتم كشفه → بانر أصفر + إدخال notification.
- أي batch بلغ `entry_date + transfer_to_hatcher_day` ولم ينقل → بانر برتقالي.
- أي lot في الهاتشر منذ > `hatcher_duration_hours` ولم ينقل للحضانات → بانر أحمر.

## 5. القيود والأمان

- لا حذف للدفعات بعد أول حركة (تحقق في الـ trigger).
- منع تكرار كشف نفس الـ lot.
- كل حركة تخزن `created_by` + `created_at`.
- الإعدادات تخزن `version` ليبقى السعر الذي حسبت به الفاتورة محفوظ في الفاتورة نفسها (snapshot).

## 6. الاختبار (المثال المرفق)

عميل أحمد واكد، 20 بيضة → كشف: 2 لايح / 18 مكمل → فقس: 16 كتكوت / 2 أكمل ولم يفقس → 4 أيام تحضين @ 15 = الفاتورة 3660 جنيه. سيتم التحقق بعد النشر.

## ملاحظات

- لا تأثير على `farm_egg_production` أو `farm_to_hatchery_shipments` الحالية.
- يدعم دفعات مختلطة (عاصمة + عميل واحد أو أكثر) عبر الـ Lots.
- جميع الأسعار والأيام قابلة للتعديل من الإعدادات.
- استخدام `openPrintWindow` لكل تصدير PDF لضمان العربية الصحيحة.
