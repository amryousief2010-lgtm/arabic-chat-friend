# تطوير نظام عهدة المندوبين

## نظرة عامة

البناء فوق الجداول الموجودة (`courier_goods_custodies`, `courier_goods_custody_lines`) داخل تبويب «خزينة المخزن الرئيسي» مع جداول وإعدادات جديدة لإغلاق الدورة المحاسبية بالكامل.

---

## 1) الحد الائتماني (Credit Limit)

- جدول جديد `courier_profiles`: `courier_name` (مفتاح فريد), `credit_limit`, `commission_type`, `commission_value`, `notes`. صلاحية التعديل: المدير العام + التنفيذي فقط.
- عند فتح نافذة «صرف بضاعة»: حساب العهدة الحالية للمندوب (مصروف − مرتجع − مبيعات). إذا (الحالي + قيمة الصرف الجديد) > الحد:
  - مستخدم عادي → منع الصرف مع تحذير أحمر، أو اختيار «طلب اعتماد» يحفظ السطر بحالة `pending_credit_override` ويرسل إشعار للمديرين.
  - مدير عام/تنفيذي → السماح المباشر مع تأكيد.
- إظهار في رأس كل عهدة: «الحد المسموح / العهدة الحالية / المتبقي» مع شريط تقدّم.

## 2) كشف حساب المندوب

- زر «كشف حساب» على كل عهدة + اختيار فترة (من/إلى أو شهر).
- يعرض: رصيد افتتاحي بداية الفترة (مجموع الحركات قبلها)، ثم بنود مفصّلة بالترتيب: صرف / مرتجع / مبيعات / خصومات / تحصيل / عجز أو زيادة / رصيد ختامي.
- طباعة عربية عبر `openPrintWindow` (نمط الموجود في الملف)، وExcel عبر `xlsx`.

## 3) العمولات

- في `courier_profiles`: `commission_type` ∈ (`percent_of_sales`, `per_kg`, `per_item`) و`commission_value`.
- جدول `courier_commission_payouts`: مبلغ مصروف، تاريخ، ملاحظات، performed_by.
- حساب العمولة المستحقة من سطور البيع المعتمدة (auto_approved + approved) داخل ملخّص العهدة، وعرض: المستحق / المصروف / المتبقي.
- صرف العمولة يخصم نقدًا من خزينة المخزن الرئيسي تلقائيًا (حركة `manual_adjust` صادرة بوصف «عمولة مندوب»).

## 4) إغلاق يوم المندوب

- جدول `courier_daily_closures`: `custody_id`, `closure_date`, snapshot للقيم (مصروف/مرتجع/مبيعات/خصومات/تحصيل/متبقي/عجز)، `closed_by`, `reopened_by`, `reopened_at`, `status` ∈ (`closed`, `reopened`).
- زر «إغلاق اليوم» يحسب الأرقام ويثبّتها ويمنع إضافة/تعديل سطور بتاريخ ≤ تاريخ الإغلاق (عبر trigger يقرأ آخر إغلاق لكل عهدة).
- زر «إعادة فتح» يظهر فقط للمدير العام/التنفيذي، يسجّل سبب الفتح في `audit_log` الموجود.

## 5) لوحة معلومات المندوبين

كرت داخل نفس التبويب يجمع:
- إجمالي البضاعة الحالية لدى جميع المندوبين.
- إجمالي تحصيلات/مرتجعات/مبيعات الفترة (آخر 30 يوم افتراضيًا).
- ترتيب أعلى مندوب في: مبيعات، خصومات، عجز، تحصيل.

## 6) الصلاحيات (RLS)

- `warehouse_supervisor` (عبدالمنعم): إنشاء حركات صرف/مرتجع/تحصيل، لا يعدّل حدود ولا عمولات ولا يعيد فتح إغلاق.
- `financial_manager` (محمد شعلة): قراءة، اعتماد التحصيلات (موجود).
- `general_manager` / `executive_manager`: كل شيء + اعتماد تجاوز الحد + إعادة فتح + تعديل حدود/عمولات.
- (مستقبلًا) دور `courier`: يرى فقط `custody_id` الخاص به عبر mapping `auth.uid()` ↔ `courier_name`. **حاليًا**: لا يوجد مستخدم مندوب في النظام، سيُترك hook جاهز للربط لاحقًا.

---

## تفاصيل تقنية

### جداول جديدة

```text
courier_profiles
  id, courier_name UNIQUE, credit_limit NUMERIC,
  commission_type TEXT CHECK IN (none|percent_of_sales|per_kg|per_item),
  commission_value NUMERIC, notes, updated_by, timestamps

courier_commission_payouts
  id, courier_name, amount, paid_at, notes, performed_by, treasury_txn_id

courier_daily_closures
  id, custody_id FK, closure_date DATE,
  goods_out, goods_returned, sales_value, discounts_value,
  cash_collected, remaining_goods, remaining_cash, deficit_or_surplus,
  closed_by, closed_at, reopened_by, reopened_at, reopen_reason,
  status CHECK IN (closed|reopened)
  UNIQUE(custody_id, closure_date)
```

### إضافات على `courier_goods_custody_lines`

- `credit_override_status` TEXT ∈ (`none`, `pending`, `approved`, `rejected`) لتجاوز الحد.
- `credit_override_by`, `credit_override_at`.

### Triggers / RPCs

- `enforce_courier_closure_lock()`: يمنع INSERT/UPDATE/DELETE على سطور بتاريخ ≤ آخر إغلاق غير معاد فتحه.
- `approve_courier_credit_override(_line_id)` / `reject_courier_credit_override`.
- `close_courier_day(_custody_id, _date)` / `reopen_courier_day(_id, _reason)` — security definer.
- `pay_courier_commission(_courier_name, _amount, _notes)` — ينشئ صف payout + حركة `manual_adjust` صادرة في خزينة المخزن.

### واجهة (داخل `MainWarehouseTreasuryTab.tsx`)

- إضافة قسم «إعدادات المندوب» (حد + عمولة) قابل للتعديل بالـ inline edit للمدير.
- توسعة كرت كل عهدة: شريط الحد، أزرار «كشف حساب»، «إغلاق اليوم»، «صرف عمولة».
- Dialogs جديدة: كشف الحساب (مع طباعة/Excel)، إعدادات المندوب، تأكيد إغلاق اليوم، صرف عمولة، طلب اعتماد تجاوز الحد.
- كرت Dashboard للمندوبين أعلى قائمة العهدات.

### اختبار

1. ضبط حد كيمو = 30,000 → محاولة صرف يتجاوز الحد → يجب أن يمنع/يطلب اعتماد.
2. اعتماد التجاوز من المدير → الحركة تصبح مرحّلة.
3. تسجيل بيع بخصم → احتساب العمولة (2%) ضمن الملخّص.
4. زر «كشف حساب» → طباعة + Excel.
5. «إغلاق اليوم» → محاولة تعديل سطر بتاريخ مغلق → ترفض من الـ trigger.
6. «إعادة فتح» من مستخدم عادي → ترفض. من المدير → تنجح وتُسجَّل.

