## الخطة المقترحة

تنقسم لخطوتين منفصلتين عشان نقدر نوقف بينهم لو حصل اعتراض على أي رقم.

---

### الخطوة 1 — تصحيحات بيانات فورية (data-only)

**أ. حذف "دين شعلة 1,400"**
- صفّ السجل `lab_treasury_historical_receivables` (id `1bb3…0829`, title `مستحقات خزنة المعمل عند المجزر`) من ملاحظة `دين شعلة = 1,400 جنيه` → نمسحها من حقل `note` فقط (السجل نفسه هو المستحق الإجمالي، مش هنحذفه).
- لو محتاج نمسح أيضًا أسطر `lab_treasury_historical_receivable_items` المتعلقة بالـ 1,400 — في الجدول حاليًا 4 أسطر (1,100 + 40,000 + 15,000 + 45 = 56,145، ولا فيهم 1,400). معناه دين شعلة كان مذكور في الـ note بس مش كـ item منفصل. **لا توجد حركة 1,400 للحذف**؛ الإزالة بالكامل من حقل `note`.

**ب. تعديل رصيد خزنة المعمل النقدي → 69,195 ج**
- نزود سجل جديد في `lab_treasury_opening_balances` بتاريخ اليوم وحالة `approved`، الكاش `69,195`، باقي الطرق `0`.
- ملاحظة `notes`: "تصحيح رصيد خزنة المعمل النقدي الفعلي حسب الجرد الحالي — لا يُعتبر إيرادًا".
- نسجّل سطر في `lab_treasury_audit_log` بنفس السبب.
- مش هنُسجّل أي حركة في `lab_treasury_movements` كـ income — احترامًا للقاعدة "ليس إيرادًا".

**ج. تعديل المستحق عند المجزر → 69,196 ج**
- نُحدّث `lab_treasury_historical_receivables.total_amount` من `69,195` → `69,196`.
- نمسح حقل `note` (إزالة دين شعلة).
- لا نُغيّر `paid_amount` ولا `status`.

**د. إظهار المبلغ كعهدة لصالح المعمل في خزنة المجزر**
- نُضيف سجل في `slaughter_custody_opening_balances` بنوع جديد + سيتم استخدامه كـ memo فقط (لا يدخل الليميت الأسبوعي).
- بدلاً من العبث بهيكل العهدة الحالي، الحل الأنظف: نتعامل مع المبلغ كقيد في **نظام السلف الجديد** (الخطوة 2) كسلفة معتمدة من المعمل للمجزر بنوع "تاريخية / opening". كده تظهر تلقائيًا في الداشبوردين بدون تشويش على عهدة المجزر الجارية.

---

### الخطوة 2 — نظام سلف وتحويلات بين الخزن

#### جداول جديدة

```text
treasury_transfers
  id, transfer_date, from_treasury, to_treasury,
  amount, payment_method (cash|vodafone_cash|instapay|bank_transfer),
  reason, handed_by, received_by, receipt_url, notes,
  status (pending|approved|rejected|cancelled),
  settlement_status (unpaid|partial|paid),
  paid_amount,
  affects_cash_now (bool), -- true لو الفلوس خرجت فعلاً، false لو قيد فقط
  created_by, approved_by, approved_at,
  rejected_by, rejected_at, rejection_reason,
  created_at, updated_at

treasury_transfer_settlements
  id, transfer_id, settlement_date, amount,
  payment_method, recorded_by, notes,
  status (pending|approved|rejected),
  approved_by, approved_at, created_at

treasury_transfer_audit_log
  id, transfer_id, action, actor_id, before_state, after_state,
  reason, created_at
```

`from_treasury`/`to_treasury` enum: `lab` (خزنة المعمل) + `slaughter` (خزنة المجزر).
بنية قابلة للتوسع لخزنات تانية (farm, factory…) لاحقًا.

#### القواعد المحاسبية المطبَّقة
- السلفة pending → **لا تؤثر** على أي رصيد.
- السلفة approved + `affects_cash_now=true` → تنقص نقد المُسلِف (لو خزنة المعمل) عن طريق view حسابية فقط، **بدون** insert في `lab_treasury_movements` كإيراد/مصروف.
- السلفة approved + `affects_cash_now=false` → قيد دفتري فقط (المبلغ موجود أصلاً عند المستلم).
- مستحق الخزنة B لصالح الخزنة A = مجموع السلف المعتمدة - مجموع السدادات المعتمدة.
- **مش بتدخل** في `slaughter_custody_weekly_limits` ولا في `lab_treasury_movements`.

#### Views
- `v_treasury_inter_balances` — لكل زوج خزن: net outstanding.
- `v_lab_treasury_dashboard` — نُضيف عمود `external_at_slaughter` = صافي المستحق على المجزر من النظام الجديد + المستحق التاريخي.

#### RLS
- INSERT: GM, EM, `lab_treasury_approver`, `lab_treasury_keeper`, slaughterhouse_manager, accountant (حسب الخزنة المنطلق منها).
- APPROVE: GM, EM, `lab_treasury_approver` فقط (وكذلك مدير المجزر لاعتماد ما يخص خزنته).
- DELETE: GM فقط مع سبب إلزامي وبعد الاعتماد لا تُحذف إلا بسبب.
- SELECT: كل أطراف الخزنتين + GM/EM/accountant.
- audit log: insert فقط من triggers، SELECT للأدوار الإدارية.

#### واجهة المستخدم
1. **`/lab-treasury` — كروت جديدة بالأعلى**
   - رصيد خزنة المعمل النقدي الفعلي = من `lab_treasury_opening_balances` + الحركات المعتمدة.
   - مستحق لخزنة المعمل عند المجزر = من النظام الجديد + المستحق التاريخي.
   - إجمالي أموال المعمل شامل المستحقات = مجموع الاثنين، مع tooltip توضيحي.
   - تبويب جديد: **السلف والتحويلات بين الخزن** (إضافة، اعتماد، سداد، فلتر بالحالة).

2. **`/slaughterhouse-custody` — كرت memo**
   - "عهدة مستحقة لصالح خزنة المعمل" = نفس الرقم.
   - بنصّ صريح: "memo — لا يدخل ضمن الليميت الأسبوعي ولا يُعتبر مصروف مجزر".

3. **dialog السلفة** — كل الحقول المطلوبة: تاريخ، من/إلى، مبلغ، طريقة دفع، سبب، مسؤول تسليم، مسؤول استلام، رفع إيصال، ملاحظات، `affects_cash_now` toggle.

4. **dialog السداد** — اختيار سلفة، مبلغ السداد، طريقة، تاريخ، حالة (pending → approved).

#### Storage
- Bucket: `treasury-transfers` (private) لصور الإيصالات.

#### Audit & لا حذف بعد الاعتماد
- trigger ON UPDATE/DELETE يُسجّل في `treasury_transfer_audit_log`.
- DELETE مرفوض على الحركات `approved` إلا للـ GM مع `deletion_reason` غير فارغ.

---

### تفاصيل تنفيذية مختصرة

- 4 migrations:
  1. (data) إزالة note + ضبط total إلى 69,196 + سجل جرد كاش + سجل audit.
  2. (schema) جداول السلف + enums + views + RLS + grants + triggers.
  3. (data) إنشاء سجل السلفة "تاريخية" بقيمة 69,196 من lab إلى slaughter (status approved, settlement_status unpaid, affects_cash_now=false).
  4. (storage) bucket `treasury-transfers` + policies.
- 3-4 ملفات frontend:
  - `src/pages/LabTreasury.tsx` (كروت + تبويب جديد).
  - `src/pages/SlaughterhouseCustody.tsx` (كرت memo).
  - `src/components/treasury/InterTreasuryTransfersTab.tsx` (جديد).
  - `src/components/treasury/TransferDialog.tsx` + `SettlementDialog.tsx`.

---

### نقاط محتاج تأكيدك عليها قبل التنفيذ

1. **الرقم 69,195 نقدًا** — حاليًا في `lab_treasury_opening_balances` آخر رصيد معتمد = 53,000 بتاريخ 2026-06-05. الفرق 16,195. هل أُسجّل التصحيح كرصيد افتتاحي جديد بتاريخ اليوم 2026-06-06 = 69,195؟ (هذا هو السلوك المقترح).

2. **سطور `historical_receivable_items` (1,100 + 40,000 + 15,000 + 45 = 56,145)** — مجموعهم 56,145، لكن المستحق الإجمالي 69,195. هل أتركهم كما هم وأضع الفرق كرصيد افتتاحي للمستحق، أم تريد مسحهم جميعًا وإعادة المستحق إلى رقم واحد مفرد = 69,196؟

3. **خزنات النظام** — هل أبدأ بـ `lab` + `slaughter` فقط، أم أضيف `farm`/`feed_factory`/`hatchery`/`meat_factory` من الآن (مع جداول جاهزة، UI لاحقًا)؟ (الأنظف: ابدأ بـ enum يقبل الأنواع كلها واستخدم اللي محتاجه في الـ UI الآن).

4. **اعتماد السلف** — هل المدير العام/التنفيذي وحدهم، أم أضيف `lab_treasury_approver` كمعتمد للسلف الصادرة من المعمل، ومدير المجزر للصادرة من المجزر؟

ابعت موافقتك على الخطة + إجابات النقاط الأربعة، وأبدأ التنفيذ على مرحلتين منفصلتين (Migration A للتصحيحات، ثم Migration B للنظام الجديد).
