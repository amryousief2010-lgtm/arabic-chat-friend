## الهدف
إنشاء **خزينة مستقلة للمخزن الرئيسي** يديرها عبدالمنعم عثمان، تظهر كتبويب واضح في شريط تبويبات صفحة `/modules/warehouses` (بجانب "سجل حركات المخزن الرئيسي")، مع دورة اعتماد للتحويلات إلى الخزينة الرئيسية (محمد شعلة).

> ملاحظة: لا توجد أي جداول/مكونات حالية باسم "خزينة المخزن الرئيسي" في الكود — سيتم إنشاء كل شيء من الصفر بنفس نمط `feed_factory_treasury_txns` و `treasury_transfers`.

---

## 1) قاعدة البيانات (Migration)

### جدول `main_warehouse_treasury_txns`
حركات خزينة المخزن الرئيسي (إيداع/سحب/تحصيل بيع مباشر/تحويل صادر):
- `id`, `created_at`, `performed_at`
- `direction` (`in` | `out`)
- `category` (`direct_sale_cash` | `transfer_to_main_treasury` | `manual_adjust` | `opening_balance` | `other`)
- `amount` (numeric)
- `reference` (نص اختياري — رقم طلب/فاتورة)
- `notes`
- `performed_by` (uuid)
- `transfer_id` (FK اختياري لـ `treasury_transfers`)
- `status` (`posted` | `pending_approval` | `rejected`)

### استخدام `treasury_transfers` الحالي
لتحويل المبالغ إلى الخزينة الرئيسية، نُدخل صفًا في `treasury_transfers` بـ:
- `source_type = 'main_warehouse'`
- `destination_type = 'main_treasury'`
- `status = 'pending_approval'`
- `requested_by = عبدالمنعم`
- ويُرسل إشعار `notifications` تلقائيًا لمحمد شعلة وفق نمط الإشعارات الموجود في المشروع.

### RLS و GRANTs
- `SELECT` للجميع الذين لديهم صلاحية مشاهدة المخازن.
- `INSERT/UPDATE` لـ عبدالمنعم عثمان (warehouse keeper المخصص) + المدير العام + المدير التنفيذي.
- اعتماد/رفض التحويل = محمد شعلة (المدير المالي/الخزينة الرئيسية) + المدير العام عبر `treasury_transfers` policies الموجودة.
- `GRANT` كامل على الجدول لـ `authenticated` و `service_role`.

---

## 2) مكون `MainWarehouseTreasuryTab.tsx`
ملف جديد في `src/components/warehouses/`، يعرض داشبورد بنفس ستايل خزينة مصنع الأعلاف:

```
+------------------------------------------------------+
| الرصيد الحالي | إيرادات اليوم | تحويلات معلّقة | المحوّل |
+------------------------------------------------------+
| [+ تسجيل تحصيل]  [→ تحويل للخزينة الرئيسية]         |
| [طباعة]  [Excel]  [PDF]                              |
+------------------------------------------------------+
| الحركات (جدول قابل للفلترة + بحث + تاريخ)            |
+------------------------------------------------------+
| التحويلات بانتظار اعتماد محمد شعلة (قسم منفصل)       |
+------------------------------------------------------+
```

### الحوارات (Dialogs)
1. **تسجيل تحصيل بيع مباشر**: مبلغ + رقم طلب (اختياري) + ملاحظات → `direction=in, category=direct_sale_cash`.
2. **تحويل إلى الخزينة الرئيسية**: مبلغ + ملاحظات + تأكيد → ينشئ `treasury_transfers` (pending) + حركة `out` بحالة `pending_approval` + إشعار لمحمد شعلة.
3. **تأكيد/رفض التحويل** (لمحمد شعلة فقط): يعدّل `treasury_transfers.status` و يثبّت/يلغي حركة الخزينة المقابلة.

### التصدير والطباعة
استخدام `openPrintWindow` من `@/lib/printPdf` (ضمن قواعد الذاكرة لطباعة العربي بشكل صحيح) + `xlsx` للإكسل بنفس النمط المستخدم في `WarehousesDashboardPanel.tsx`.

---

## 3) دمج التبويب في `Warehouses.tsx`

إضافة TabsTrigger بعد "سجل حركات المخزن الرئيسي" (السطر ~1001):

```tsx
<TabsTrigger value="wh-treasury" className="gap-1">
  <Wallet className="w-4 h-4" />خزينة المخزن الرئيسي
</TabsTrigger>
```

و `TabsContent` يحمل المكون الجديد، مع شرط ظهور: المدير العام/التنفيذي/المالي + عبدالمنعم عثمان (warehouse keeper المخزن الرئيسي). إذا لم تكن لديه صلاحية → التبويب مخفي.

كذلك إضافة بند موازٍ داخل قائمة "المزيد" حتى تظهر في حالة ضيق الشاشة (نفس النمط الموجود للتبويبات الأخرى في السطور 1429-1431).

---

## 4) الصلاحيات (RBAC)
استخدام `useAuth`:
- `canManageMainWarehouseTreasury = isGeneralManager || isExecutiveManager || isFinancialManager || (isWarehouseKeeper && warehouse === 'main')`
- `canApproveMainTreasuryTransfer = isGeneralManager || isFinancialManager` (محمد شعلة لديه دور `financial_manager`).

---

## 5) الإشعارات
عند إنشاء تحويل: `notifications.insert({ type: 'main_warehouse_transfer_pending', title, message, user_id: <محمد شعلة> })` — نفس النمط الموجود في `treasury_transfers` و `feed_internal_payments`.

---

## ضمانات
- **لا يتم تعديل أي جدول حالي** غير إضافة FK اختياري في الـ migration الجديد.
- **لا يتم حذف أي تبويب** قديم.
- **لا تتأثر الأرصدة الحالية** للمخازن أو الخزينة الرئيسية إلا عند اعتماد محمد شعلة للتحويل.
- جميع الـ GRANTs و RLS مكتوبة في نفس الـ migration.

---

## التسليم بعد التنفيذ
1. تبويب "خزينة المخزن الرئيسي" ظاهر في شريط التبويبات العلوي.
2. عبدالمنعم يرى الخزينة ويستطيع التسجيل والتحويل.
3. محمد شعلة يرى إشعار التحويل ويعتمده/يرفضه.
4. التصدير والطباعة يعملان (عربي صحيح).

---

**هل أبدأ التنفيذ بهذا الشكل؟** ولديّ سؤالان قبل الانطلاق:
1. هل لـ عبدالمنعم عثمان دور موجود فعلًا في `user_roles` (مثل `warehouse_keeper` أو دور مخصص)؟ أم نعتمد على `profiles.full_name` للتمييز؟
2. هل تريد رصيد افتتاحي للخزينة عند الإنشاء (مثلاً 0 أم مبلغ محدد تدخله أنت)؟