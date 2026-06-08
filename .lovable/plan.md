# خطة تنفيذ نظام العُهد داخل خزنة معمل الكتاكيت

## 1) سبب رسالة الخطأ الحالية
- الخطأ يأتي من trigger `lab_treasury_check_expense_balance` على جدول `lab_treasury_movements`.
- نموذج إضافة المصروف في `LabTreasury.tsx` لا يحتوي أي ضرب أو حساب تلقائي — الحقل `amount` يُحفظ كما أدخله المستخدم. لا يوجد سبب برمجي لتحويل 1000 إلى 45600.
- على الأغلب الرقم الكبير ناتج عن إدخال يدوي خاطئ (أو لصق رقم) في حقل المبلغ. سأضيف مع المرحلة الجديدة:
  - تحقق أمامي قبل الإرسال (المبلغ ≤ الرصيد المتاح).
  - رسالة خطأ أوضح تعرض المبلغ الذي أدخله المستخدم + الرصيد المتاح، مع زر "تصحيح المبلغ" يعيد تركيز الحقل.

## 2) قاعدة البيانات (Migration واحدة)

### جدول جديد `lab_treasury_advances` (العُهد المفتوحة)
- `employee_user_id` (uuid → profiles), `recipient_name` (نص حر للتسجيل في حالة عدم وجود حساب).
- `issued_at` (date), `amount` (numeric).
- `payment_method` (نفس enum خزنة المعمل).
- `purpose` (نص), `notes` (نص).
- `status`: enum جديد `lab_treasury_advance_status` = `open | settled | closed | cancelled`.
- `issue_movement_id` (FK لـ `lab_treasury_movements`) → الحركة التي خصمت العهدة من الخزنة.
- `actual_expense_total`, `returned_amount`, `pending_employee_amount` (numeric, محسوبة عند التسوية).
- `settled_at`, `settled_by`, `manager_approval_at`, `manager_approval_by` (للفرق المستحق).

### جدول `lab_treasury_advance_settlements`
- `advance_id` FK, `line_no`, `description`, `amount`, `expense_category` (نفس enum الموجود).
- يُستخدم لعرض تفاصيل المصروفات الفعلية + للترحيل النهائي للتقارير.

### RPC آمنة (SECURITY DEFINER) — لمنع الحركات المكررة
- `lab_treasury_issue_advance(p_recipient, p_employee, p_amount, p_method, p_purpose, p_notes, p_date)`
  - يتحقق من الرصيد (نفس قاعدة المصروف العادي + يحترم استثناء GM/Exec).
  - يُنشئ صف في `lab_treasury_movements` بنوع `expense` وفئة جديدة `advance_issue` وحالة `pending` (تخضع لنفس workflow الاعتماد).
  - يُنشئ صف في `lab_treasury_advances` بحالة `open` يربط `issue_movement_id`.
  - يكتب سطر في `lab_treasury_audit_log` (action = `advance_issue`).
- `lab_treasury_settle_advance(p_advance_id, p_lines jsonb, p_returned_amount)`
  - يتحقق أن العهدة `open`.
  - يحسب `actual_total = SUM(p_lines.amount)`.
  - يتحقق: `actual_total + p_returned_amount = amount` أو يحدد `pending_employee_amount = actual_total - amount` (موجبًا فقط).
  - لو فيه مرتجع: ينشئ حركة income في الخزنة بفئة جديدة `advance_return` (approved تلقائياً لأنها رد لخزنة بنفس payment_method).
  - **لا يُنشئ مصروف ثاني** بمبلغ العهدة. تفاصيل التسوية تُحفظ في الجدول، والتقارير الحقيقية تستخدمها (انظر فقرة 4).
  - يضع status = `settled` ويسجل audit `advance_settle`.
  - لو في فرق مستحق للموظف: يبقى `pending_employee_amount > 0` ويحتاج اعتماد مدير.
- `lab_treasury_approve_advance_difference(p_advance_id)` — للمدير فقط، ينشئ حركة `expense` بفئة `advance_difference_payout` ويسجل audit + يضع `closed`.
- `lab_treasury_cancel_advance(...)` (اختياري للمدير قبل التسوية).

### تعديلات على enums الموجودة
- إضافة `advance_issue`, `advance_return`, `advance_difference_payout` إلى enum فئات المصروف/الإيراد بحيث تظهر بتسمية واضحة في السجلات.

### تعديل trigger الرصيد
- لا يحتاج تغيير منطق؛ يكفي أن RPC الإصدار يستخدم نفس الـ trigger.
- لكن سأحسّن نص الخطأ ليصبح بالعربية ويوضح payment_method.

### حماية RLS
- نفس قواعد `lab_treasury_movements`: الإدخال عبر RPC فقط (سنمنح EXECUTE لـ authenticated وندع الـ RPC تتحقق من الأدوار داخلياً).
- العرض: مفتوح للأدوار الحالية (GM, executive, accountant, financial_manager, lab_treasury_keeper, lab_treasury_approver, lab_external_collector لعهد نفسه فقط).

## 3) الواجهة (`/lab-treasury`)
- تبويب جديد **"العُهد"** يحتوي قسمين:
  1. **صرف عهدة جديدة** (نموذج): الموظف، المبلغ، طريقة الدفع، الغرض، التاريخ، ملاحظات + تحقق أمامي للرصيد.
  2. **العُهد المفتوحة** (جدول): اسم الموظف، المبلغ، التاريخ، الغرض، المصروف الفعلي حتى الآن (= مجموع settlements إن وجدت)، المتبقي/العجز، الحالة، زر "تسوية".
  3. **العُهد المسواة/المغلقة** (تبويب فرعي أو فلتر).
- **Dialog تسوية العهدة**: جدول لإضافة بنود (وصف + فئة + مبلغ)، حقل "مرتجع للخزنة"، حساب تلقائي للفرق، زر حفظ.
- **زر اعتماد الفرق** يظهر للمدير فقط على العهد التي بها `pending_employee_amount > 0`.

## 4) تقرير العُهد
- صفحة جديدة `/lab-treasury/advances-report` (وزر دخول من تبويب العُهد).
- KPIs: إجمالي عهد مصروفة، إجمالي مصروفات فعلية (من settlements)، إجمالي مرتجعات، إجمالي فروق مستحقة، عدد عهد مفتوحة/مسواة.
- جداول: العهد المفتوحة، العهد المسواة (مع تفاصيل بنودها)، الفروق التي تنتظر اعتماد.
- فلتر بالتاريخ والموظف.

## 5) أثر على باقي التقارير
- التقرير اليومي/الشهري لخزنة المعمل سيظل يعرض مصروف "صرف عهدة" بفئة `advance_issue` كأثر فعلي على الرصيد.
- لكن **التقارير التشغيلية للمصروفات الحقيقية** سترتكز على `lab_treasury_advance_settlements` بدلاً من حركة العهدة (لتجنب الاحتساب المزدوج). سأضيف ملاحظة واضحة في `/lab-treasury` يوضح هذا التمييز.

## 6) Audit Log
- استخدام `lab_treasury_audit_log` الحالي مع actions جديدة: `advance_issue`, `advance_edit`, `advance_settle`, `advance_return`, `advance_difference_payout`, `advance_cancel`.

## 7) Out of scope (لن يتم في هذه الخطوة)
- لن أعدل خزنة عهدة المجزر `/slaughterhouse-custody` (نظام مستقل).
- لن أتطرق لـ Phase 2 من المساعد الذكي.

---

هل أبدأ التنفيذ؟ أو هل تريد:
- تسمية مختلفة للتبويب/الصفحة؟
- تقييد "صرف عهدة" على دور محدد فقط (الافتراضي: نفس من يسجل المصروفات حالياً = `lab_treasury_keeper` + GM + Executive + accountant + financial_manager)؟
- اعتماد تلقائي لحركة الإصدار (`approved`) بدلاً من `pending` لتسريع العمل؟
