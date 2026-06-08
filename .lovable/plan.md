
# نظام كشف حساب عملاء معمل التفريخ

## الهدف
ربط نتائج دفعات التفريخ + تحصيلات خزنة المعمل في **كشف حساب موحد** لكل عميل (بما فيهم "العاصمة")، مع ترحيل الحركات التاريخية وتقفيل العملاء حتى الدفعة 15.

## الأسعار الموحدة (Defaults قابلة للتعديل لكل عميل)
- بيض لايح: **50 ج/بيضة**
- بيض كشف 2 (نافق ك2): **100 ج/بيضة**
- كتكوت فاقس: **150 ج/كتكوت**
- تحضين: **10 ج/كتكوت/يوم**
- خصم: اختياري لكل دفعة

> ملاحظة: هذه الأسعار **تتجاوز** أي أسعار قديمة في `hatch_customers` (incubation/infertile/hatcher_price) للحساب الجديد، ويتم تخزينها كـ snapshot على كل حركة لمنع التغير الرجعي.

## 1) قاعدة البيانات

### جدول جديد: `lab_customer_ledger`
| العمود | الوصف |
|---|---|
| `customer_id` | عميل من `hatch_customers` |
| `entry_date` | تاريخ الحركة |
| `entry_type` | `batch_charge` / `collection` / `discount` / `internal_settlement` / `adjustment` / `reversal` |
| `source_type` + `source_id` | المصدر (batch / lab_treasury_movement / opening) |
| `batch_number`, `operational_batch_no` | للعرض |
| `infertile_eggs`, `candle2_dead`, `chicks`, `brooding_chicks`, `brooding_days` | الكميات |
| `infertile_price`, `candle2_price`, `chick_price`, `brooding_price` | snapshot الأسعار |
| `subtotal`, `discount`, `debit`, `credit`, `net_amount` | المبالغ |
| `payment_method`, `receipt_no`, `notes` | للتحصيل |
| `running_balance` | الرصيد بعد الحركة (يُحسب بـ trigger) |
| `created_by`, `created_at`, `updated_at` | audit |

**Unique constraints (منع التكرار):**
- `(source_type, source_id, customer_id)` حيث `entry_type IN ('batch_charge','collection')`

### جدول جديد: `lab_customer_ledger_audit`
يسجل كل insert/update/delete (user, old, new, reason).

### View: `v_lab_customer_balances`
ملخص لكل عميل (total_debit, total_credit, balance, batches_count, last_batch_date, last_payment_date, status).

### Triggers
- `trg_hatch_batch_to_ledger` — AFTER INSERT/UPDATE على `hatch_batches`: عند `status='completed'` ينشئ/يحدّث حركة `batch_charge` للعميل (يستخدم `(source_type='hatch_batch', source_id=batch.id, customer_id)` لمنع التكرار، عند التعديل يحدّث القيم بدل إنشاء جديد).
- `trg_lab_treasury_to_ledger` — AFTER INSERT/UPDATE/DELETE على `lab_treasury_movements`: عند movement فيه `customer_id` وحالة approved + income → ينشئ حركة `collection`. عند رفض/حذف → reversal.
- `trg_ledger_running_balance` — يعيد حساب `running_balance` لكل سجلات العميل بعد أي تغيير (ordered by entry_date, created_at).

### RLS / GRANT
- قراءة: GM, executive, accountant, financial_manager, lab_treasury_keeper.
- كتابة مباشرة: GM/executive فقط؛ باقي الحركات تأتي عبر triggers (security definer).

## 2) ترحيل البيانات التاريخية (Backfill Migration)

خطوات في migration واحد:
1. لكل عميل في كل دفعة (`hatch_batches` حيث `is_test != true`، عميل غير orphan، `status='completed'`):
   - احسب `subtotal` بالمعادلة أعلاه و insert في `lab_customer_ledger` كـ `batch_charge`.
2. لكل تحصيل سابق في `lab_treasury_movements` (income + customer_id + approved) → insert كـ `collection`.
3. **تقفيل الدفعات حتى 15**: لكل عميل له batches بـ `operational_batch_no <= 15`، إذا كان `balance > 0` بعد الخطوتين → أنشئ حركة `collection` تلقائية بـ `payment_method='historical_settlement'`, `notes='تسوية تاريخية حتى الدفعة 15'` تساوي المتبقي بالضبط. هذه الحركات **لا تدخل خزنة المعمل** (source_type='historical_closeout').
4. شغّل `trg_ledger_running_balance` لإعادة حساب كل الأرصدة.
5. تقرير validation داخل الـ migration (RAISE NOTICE) بعدد العملاء، الإجمالي المدين، الإجمالي الدائن.

## 3) Frontend

### صفحة جديدة: `/lab-treasury/customer-statement`
`src/pages/lab-treasury/LabCustomerStatement.tsx`
- اختيار العميل (Combobox من `hatch_customers` + خيار "العاصمة" مثبت في الأعلى).
- فلاتر: من/إلى تاريخ، رقم الدفعة.
- ملخص (StatCards): إجمالي مستحقات، إجمالي مدفوعات، الرصيد، عدد الدفعات، آخر دفعة، آخر تحصيل.
- جدول الحركات بكل الأعمدة المطلوبة + `running_balance`.
- زر **تسجيل تحصيل** → يفتح dialog يضيف حركة في `lab_treasury_movements` (تذهب لـ pending → عند الاعتماد تظهر في الكشف).
- زر **تسوية داخلية** (للعاصمة فقط، صلاحية GM) → ينشئ مباشرة `internal_settlement` في الـ ledger بدون أثر على الخزنة.
- زر **تسجيل خصم** (GM) → حركة `discount`.
- طباعة PDF عبر `openPrintWindow` (من `@/lib/printPdf`) + تصدير Excel.

### صفحة جديدة: `/lab-treasury/customer-balances`
`src/pages/lab-treasury/LabCustomerBalances.tsx`
- جدول كل العملاء من view `v_lab_customer_balances`.
- فلاتر: اسم، حالة (مديونية / مسدد / رصيد مقدم / مسدد جزئيًا / لا يوجد رصيد)، تاريخ.
- بادج ملونة لكل حالة.
- نقر على عميل → ينقل لصفحة كشف الحساب بفلتر العميل.
- تصدير PDF/Excel للقائمة كاملة.

### Navigation
إضافة العنصرين تحت قسم "خزنة المعمل" في `SidebarMenuSections.tsx` + registration في `AnimatedRoutes.tsx`.

## 4) قواعد محورية
- نتائج الدفعة = **مديونية فقط**، لا تلمس الخزنة.
- التحصيل من خزنة المعمل = **دائن في الكشف فقط**، الكاش يدخل من جدول `lab_treasury_movements` كما هو الآن.
- تسوية داخلية للعاصمة = **دائن في الكشف بدون تأثير على رصيد الخزنة**.
- التعديل = تحديث نفس الحركة (نفس source_id) أو reversal — لا حذف.
- كل العمليات مسجلة في `lab_customer_ledger_audit`.

## الملفات المتأثرة
- **Migration واحد**: جدول `lab_customer_ledger` + audit + view + triggers + backfill + historical closeout للدفعات ≤15.
- **جديد**: `src/pages/lab-treasury/LabCustomerStatement.tsx`
- **جديد**: `src/pages/lab-treasury/LabCustomerBalances.tsx`
- **جديد**: `src/components/lab-treasury/RecordLabCollectionDialog.tsx` (مشترك)
- **تعديل**: `src/components/AnimatedRoutes.tsx`, `src/components/layout/SidebarMenuSections.tsx`
- **Memory update**: ملف جديد `mem://features/lab-customer-ledger`

## نقاط أحتاج تأكيدك عليها قبل التنفيذ
1. **عميل "العاصمة"** — هل أنشئه تلقائيًا في `hatch_customers` بـ `customer_type='internal'` إن لم يكن موجودًا؟ أم تستخدم اسم آخر دقيق؟
2. **تقفيل الدفعات ≤15**: هل أُنشئ تسوية تلقائية لكل المتبقي (الافتراض الحالي)، أم تريد أن تنشأ كـ `historical_opening_balance = 0` فقط للعملاء المسددين بالكامل وتترك الباقي للمراجعة اليدوية؟
3. **التحضين** — العدد من أين؟ هل من جدول `brooding_batches` المرتبط، أم حقل يدوي في dialog نتائج الفقس؟
