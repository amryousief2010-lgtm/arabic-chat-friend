## نظام تجارة الكتاكيت — معمل التفريخ والحضانات

نظام جديد منفصل تمامًا عن إنتاج التفريخ وعن دفعات التحضين الداخلية، لإدارة دورة شراء كتاكيت من مزارع خارجية، تحضينها، ثم بيعها بربح.

---

### 1) قاعدة البيانات (Migration واحدة)

**جداول جديدة:**

- `chick_trading_batches` — دفعة تجارة
  - `batch_no` (TRD-CHICKS-YYYYMMDD-NNNN), `supplier_name`, `purchase_date`, `age_at_purchase`, `original_count`, `current_count`, `dead_count`, `sold_count`, `unit_purchase_price`, `purchase_total`, `transport_cost`, `disinfection_cost`, `other_costs`, `notes`, `attachment_url`, `status` (open/closed/cancelled), `treasury_source` (lab/main), `created_by`, audit timestamps.

- `chick_trading_expenses` — مصروفات أثناء التحضين (علف/أدوية/أخرى)
  - `batch_id`, `expense_type` (feed/medicine/other), `amount`, `quantity`, `unit`, `notes`, `expense_date`, `created_by`.

- `chick_trading_mortality` — نافق
  - `batch_id`, `count`, `mortality_date`, `reason`, `created_by`.

- `chick_trading_sales` — بيع
  - `sale_no`, `batch_id`, `customer_name`, `phone`, `address`, `quantity`, `unit_price`, `total`, `payment_method` (cash/credit/transfer), `treasury_destination` (lab/main), `sale_date`, `collected` (bool), `collected_at`, `collection_treasury` (lab/main), `notes`, `created_by`.

- `chick_trading_audit_log` — سجل تدقيق لكل العمليات.

**Triggers:**

1. على `INSERT chick_trading_batches`: 
   - يخصم `purchase_total + transport + disinfection + other` من الخزنة المختارة (`lab_treasury_movements` أو `main_treasury_transactions`) ببيان "شراء كتاكيت تجارة من [supplier]".
   - يربط الحركة بـ `ref_table='chick_trading_batch'`, `ref_id=batch.id`.

2. على `INSERT chick_trading_expenses`: يخصم من نفس خزنة الدفعة، بيان "مصروف تجارة كتاكيت — [type]".

3. على `INSERT chick_trading_mortality`: ينقص `current_count` و يزيد `dead_count`.

4. على `INSERT chick_trading_sales`:
   - يتحقق `quantity <= current_count`.
   - يخصم من `current_count` ويضيف لـ `sold_count`.
   - لو `payment_method != credit`: يضيف إيراد في الخزنة المختارة، بيان "بيع كتاكيت تجارة للعميل [name]".
   - لو آجل: لا يدخل الخزنة (يبقى مديونية في `lab_customer_ledger` أو سجل مديونية بسيط).

5. على `DELETE/UPDATE`: كل تغيير يُسجَّل في `chick_trading_audit_log` ويعكس أثره على الخزنة.

**RPC functions:**
- `compute_chick_trading_batch_pnl(batch_id)` → JSON بكل أرقام الربح/الخسارة (تكلفة الشراء، المصروفات، المباع، المحصل، المديونية، صافي الربح، تكلفة الكتكوت الحالية).

**RLS:** القراءة لكل المصرح لهم، الكتابة للأدوار: `general_manager`, `executive_manager`, `lab_manager` (دور جديد إن لزم) + `chick_trading_operator`.

---

### 2) واجهة المستخدم — Tab جديد "تجارة كتاكيت"

في صفحة معمل التفريخ والحضانات، أضف Tab بالاسم "تجارة كتاكيت" بجانب التابات الموجودة (الدفعات، النافق، صرف علف، ... إلخ كما في الصورة).

**ملفات React جديدة:**

```
src/pages/hatchery/ChickTradingTab.tsx          ← الحاوي الرئيسي مع 4 تابات فرعية
src/components/chick-trading/
  ├─ ChickTradingDashboard.tsx                  ← ملخص + KPIs
  ├─ ChickTradingBatchesList.tsx                ← قائمة دفعات التجارة
  ├─ ChickTradingBatchDetail.tsx                ← تفاصيل دفعة + المصروفات/النافق/المبيعات/الربح
  ├─ NewChickTradingPurchaseDialog.tsx          ← شاشة شراء (مع اختيار الخزنة)
  ├─ NewChickTradingSaleDialog.tsx              ← شاشة بيع (مع اختيار خزنة التحصيل)
  ├─ AddTradingExpenseDialog.tsx                ← صرف علف/أدوية/أخرى
  ├─ AddTradingMortalityDialog.tsx              ← تسجيل نافق
  ├─ ChickTradingReport.tsx                     ← تقرير الربح والخسارة
  └─ TradingBatchPnLPanel.tsx                   ← لوحة ربح/خسارة لكل دفعة
```

**شارة "تجارة"** تظهر في:
- قائمة دفعات التجارة (Badge برتقالي).
- في تاب "دفعات التحضين" الأصلي: مجرد ربط/رابط لقائمة تجارة الكتاكيت (لا نخلطها مع دفعات BRD-).

**Hooks مشتركة:**
```
src/hooks/useChickTrading.tsx                   ← list/get/create/update لكل العمليات
```

---

### 3) تكامل الخزائن

- **خزنة المعمل**: نستخدم `lab_treasury_movements` (kind: `out / chick_trading_purchase` و `in / chick_trading_sale`).
- **الخزنة الرئيسية**: نستخدم `main_treasury_transactions` (category جديدة: "تجارة كتاكيت").

عند الشراء: حركة واحدة فقط، خزنة واحدة، بربط `ref`.
عند البيع نقدي: حركة واحدة فقط في الخزنة المختارة.
عند البيع آجل: لا حركة الآن — يظهر زر "تحصيل" لاحقًا داخل تفاصيل البيع، عند الضغط يطلب الخزنة ويسجل الإيراد.

Unique indexes تمنع تكرار حركة الخزنة لنفس (ref_table, ref_id, kind).

---

### 4) القيود والأمان

- لا يمكن بيع `quantity > current_count` (CHECK + trigger).
- إلغاء دفعة شراء يعكس حركة الخزنة ويسجل في audit.
- إلغاء بيع آجل قبل التحصيل: يرد العدد للدفعة فقط.
- إلغاء بيع نقدي: يعكس إيراد الخزنة ويرد العدد.
- لا يؤثر النظام إطلاقًا على `hatch_batches`, `hatchery_batch_lots`, `brooding_batches`, ولا فواتير `hatchery_client_invoices`.

---

### 5) الاختبارات اليدوية بعد التنفيذ

1. شراء 100 كتكوت × 50 ج من خزنة المعمل → التحقق من ظهور المصروف ودفعة TRD-CHICKS-...
2. صرف علف 200 ج على الدفعة → تكلفة الكتكوت تتحدث.
3. بيع 50 كتكوت × 80 ج نقدي للخزنة الرئيسية → دخول الإيراد + نقص الرصيد.
4. بيع آجل: لا تتأثر الخزنة، يظهر في مديونية العميل.
5. تقرير الربح/الخسارة يعرض كل الأرقام صحيحة.

---

### ملاحظات تقنية

- لو وافقت أولاً على المُهاجرة، أنشئها قبل كتابة الواجهة لأن types ستتولد بعدها.
- الواجهة Arabic/RTL، ألوان Purple/Orange، framer-motion للانتقالات (التزامًا بقواعد المشروع).
- استخدام `@/lib/cairoDate` لكل فلاتر التاريخ.
- PDF prints عبر `openPrintWindow` من `@/lib/printPdf`.

هل أبدأ بالمهاجرة (الجداول + التريجرز + RPC)؟ بمجرد اعتمادها، سأبني كل شاشات الواجهة في نفس الدورة.