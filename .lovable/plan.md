
# خزنة عهدة المجزر — محمد شعلة + تحديث Dashboard خزنة المعمل

خزنة مستقلة تمامًا عن خزنة المعمل والحضانات، لتسجيل ومراجعة المصروفات اليومية للمجزر التي يصرفها محمد شعلة من عهدته، مع حد أسبوعي وWorkflow اعتماد كامل.

## 1. قاعدة البيانات (Migration واحدة)

### Enums جديدة
- `slaughter_custody_status`: `pending_review`, `clarification_needed`, `approved`, `rejected`, `over_limit_pending`
- `slaughter_custody_payment_method`: `cash`, `vodafone_cash`, `instapay`, `bank_transfer`
- `slaughter_custody_category`: 13 بند + `other`

### Role جديد
- إضافة `slaughterhouse_custody_keeper` إلى enum `app_role`
- منحه لمحمد شعلة (نفس user id الموجود لـ `lab_external_collector`)

### جداول جديدة (كلها بـ GRANT + RLS)
1. **`slaughter_custody_opening_balances`** — رصيد افتتاحي للعهدة + توزيع حسب طريقة الدفع + approval.
2. **`slaughter_custody_weekly_limits`** — `week_start_date`, `week_end_date`, `limit_amount`, `set_by`, `notes`. مفتاح فريد على الأسبوع.
3. **`slaughter_custody_expenses`** — كل البيانات (تاريخ، بند، وصف، مبلغ، طريقة دفع، مستفيد، فاتورة؟، صورة، ملاحظات، حالة، سبب رفض، created_by، approved_by، approved_at).
4. **`slaughter_custody_comments`** — تعليقات/توضيحات على مصروف معين (comment_by, body, attachment_url).
5. **`slaughter_custody_week_closures`** — إقفال/إعادة فتح أسبوع.
6. **`slaughter_custody_audit_log`** — كل عملية (action, entity, entity_id, actor, payload jsonb).

### Views
- `v_slaughter_custody_balance` — رصيد العهدة الحالي = opening + توريدات معتمدة - مصروفات معتمدة.
- `v_slaughter_custody_week_usage` — للأسبوع الحالي: حد، معتمد، معلق، متبقي، نسبة استهلاك.
- `v_slaughter_custody_dashboard` — تجميع كل KPIs الـ Dashboard.

### Triggers / Functions
- `slaughter_custody_set_status()`: عند insert يحدد تلقائيًا `pending_review` أو `over_limit_pending` لو المبلغ يتجاوز المتبقي من الحد الأسبوعي.
- `slaughter_custody_audit()`: trigger AFTER INSERT/UPDATE/DELETE على expenses/limits/closures/comments → audit log.
- `has_role()` يُستخدم في كل RLS.

### RLS policies (مختصر)
- **slaughterhouse_custody_keeper (شعلة):**
  - SELECT/INSERT على expenses الخاصة به فقط (`created_by = auth.uid()`).
  - SELECT على opening/limits/balance views.
  - INSERT على comments الخاصة بمصروفاته فقط، ردًا على طلب توضيح.
  - **لا** UPDATE، **لا** DELETE.
- **الإدارة** (`general_manager`, `executive_manager`, `lab_treasury_approver` للسيد الجمل، `slaughterhouse_manager`):
  - SELECT الكل، UPDATE الحالة + سبب رفض + اعتماد تجاوز.
  - INSERT/UPDATE على opening + limits + closures.
  - DELETE فقط لـ general_manager (نادر، مع audit).
- **منع** أي وصول للأدوار الأخرى.

## 2. Frontend

### Routes جديدة
- `/slaughterhouse-custody` — صفحة شعلة + Dashboard كامل للإدارة (نفس الصفحة، تتفرّع حسب role).

### ملفات جديدة
- `src/pages/SlaughterhouseCustody.tsx` — الصفحة الرئيسية (Tabs: Dashboard / المصروفات / إضافة مصروف / الحد الأسبوعي / Audit / محضر جرد).
- `src/pages/slaughterhouse-custody/CustodyDashboard.tsx` — كل الـ KPI cards + آخر 10 + آخر تعليقات + روابط سريعة.
- `src/pages/slaughterhouse-custody/CustodyExpensesList.tsx` — جدول مع فلاتر (حالة، بند، تاريخ، طريقة دفع) + actions (اعتماد/رفض/طلب توضيح للإدارة، رد على تعليق لشعلة).
- `src/pages/slaughterhouse-custody/AddCustodyExpense.tsx` — Form كامل + رفع صورة فاتورة + validation (وصف إجباري لو "أخرى").
- `src/pages/slaughterhouse-custody/WeeklyLimitPanel.tsx` — للإدارة فقط، تحديد/تعديل الحد.
- `src/pages/slaughterhouse-custody/CustodyReports.tsx` — كل التقارير (يومي/أسبوعي/شهري/حسب البند/حسب طريقة الدفع/مرفوضة/تجاوزات) + تصدير Excel/PDF.
- `src/pages/slaughterhouse-custody/CustodyInventorySheet.tsx` — محضر جرد للطباعة (تاريخ، اسم محمد شعلة، رصيد + توقيعات).

### Storage
- Bucket جديد `slaughter-custody-receipts` (private) + RLS:
  - شعلة: INSERT في `{auth.uid()}/...`.
  - الإدارة: SELECT كل الـ bucket.
  - شعلة: SELECT فقط لملفاته.

### تحديثات على الموجود
- `src/hooks/useAuth.tsx` — إضافة `slaughterhouse_custody_keeper` إلى `AppRole` + helper `isSlaughterhouseCustodyKeeper`.
- `src/constants/roleLandings.ts` — landing = `/slaughterhouse-custody`.
- `src/components/AnimatedRoutes.tsx` — Route جديد محمي بـ ProtectedRoute.
- `src/components/layout/SidebarMenuSections.tsx` — entry في قسم المجزر (يظهر للإدارة + شعلة + slaughterhouse_manager).
- `src/pages/Permissions.tsx` — توثيق الدور الجديد.

### Dashboard خزنة المعمل (`src/pages/LabTreasury.tsx`)
إعادة هيكلة Tab "نظرة عامة" لعرض الـ 10 عناصر المطلوبة بترتيب واضح:
1. رصيد الخزنة الرسمي المعتمد
2. الرصيد الفعلي داخل الخزنة
3. التحصيلات الخارجية غير الموردة (Total)
4. **تحصيلات محمد شعلة للمعمل فقط** (Card جديد — `lab_treasury_external_collections` WHERE `collector_id = shola_user_id` AND `deposit_status != fully_deposited`)
5. إجمالي أموال المعمل = (1) + (3)
6. الحركات بانتظار اعتماد السيد الجمل (count + sum)
7. التوريدات المعلقة من شعلة (count من `lab_treasury_external_deposits` WHERE status = pending)
8. آخر حركة اعتماد (تاريخ + نوع + مبلغ)
9. آخر محضر جرد (من `lab_treasury_day_closures` آخر صف)
10. Quick links → تقرير التحصيلات الخارجية + Audit Log
+ Banner واضح: "هذه الخزنة منفصلة تمامًا عن خزنة عهدة المجزر"

## 3. ملفات Memory
- `mem://features/slaughterhouse-custody` — وصف الخزنة، الـ role، الـ workflow، الحد الأسبوعي.
- تحديث `mem://index.md` بسطر Core: "خزنة عهدة المجزر منفصلة تمامًا عن خزنة المعمل والحضانات."
- تحديث `mem://auth/lab-treasury-roles` بإضافة `slaughterhouse_custody_keeper`.

## 4. ترتيب التنفيذ
1. Migration (جداول + enums + role + RLS + triggers + views).
2. Storage bucket + RLS.
3. منح الدور لمحمد شعلة (insert).
4. تحديث `useAuth` + `roleLandings` + `AnimatedRoutes` + Sidebar.
5. صفحات الـ custody (Dashboard، Expenses، Add، Limit، Reports، Inventory).
6. تحديث `LabTreasury.tsx` Dashboard.
7. Memory files.

## ملاحظات
- كل المبالغ المعتمدة فقط تدخل في رصيد العهدة.
- تجاوز الحد → status `over_limit_pending` + يحتاج اعتماد إداري عالي (GM/Executive/السيد الجمل).
- لا يوجد UPDATE من واجهة شعلة بعد الإرسال؛ لو محتاج تعديل، يضيف توضيح عبر comment.
- محضر الجرد PDF بـ `openPrintWindow` من `@/lib/printPdf` (Arabic-safe).
- التقارير: Excel عبر `safeExcel`، PDF عبر `printPdf`.

هل أبدأ التنفيذ؟
