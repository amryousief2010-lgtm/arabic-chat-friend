# خزنة المعمل والحضانات

نظام خزنة مالية مستقلة تمامًا لإيرادات ومصروفات معمل التفريخ وحضانات الكتاكيت، المسؤول عنها: محمد خالد.

## 1) قاعدة البيانات (Migration واحد)

### Enums جديدة
- `lab_treasury_payment_method`: `cash` | `vodafone_cash` | `instapay` | `bank_transfer`
- `lab_treasury_movement_type`: `income` | `expense`
- `lab_treasury_status`: `pending` | `approved` | `rejected`
- `lab_treasury_income_category`: `hatching` | `chick_sales` | `other`
- `lab_treasury_expense_category`: `electricity` | `maintenance` | `water` | `salaries_mother_farm` | `salaries_hatchery` | `salaries_brooding` | `medicine` | `feed_supplies` | `tools` | `transport` | `other`

### جدول `lab_treasury_movements`
حقول الأعمال:
- `movement_type` (enum) — إيراد/مصروف
- `movement_date` (date) + `created_at` (timestamptz)
- `income_category` / `expense_category` (nullable حسب النوع)
- `customer_name`، `units_count` (numeric, nullable)، `unit_price` (numeric, nullable)
- `amount` (numeric, > 0)
- `payment_method` (enum)
- `description`، `beneficiary`، `notes`
- `receipt_url` (text — صورة إيصال على Storage)
- `status` (enum, default `pending`)
- `created_by` (uuid → auth.users)، `approved_by`، `approved_at`، `rejection_reason`
- `balance_after` (numeric) — يحتسبه Trigger للحركات المعتمدة فقط

Trigger validation: إذا `movement_type = income` يجب وجود `income_category`، وإذا `expense` يجب `expense_category`. لا CHECK constraints على تواريخ.

Trigger للرصيد: عند تحديث الحالة إلى `approved`، يحسب `balance_after` بناءً على ترتيب التاريخ.

### Storage Bucket
`lab-treasury-receipts` (private) مع RLS للقراءة لنفس الأدوار.

### GRANTs + RLS
- GRANT SELECT/INSERT/UPDATE/DELETE on `lab_treasury_movements` to `authenticated`، ALL to `service_role`.
- RLS:
  - **SELECT**: `general_manager`, `executive_manager`, `accountant`, `financial_manager`, أو `created_by = auth.uid()` (لمحمد خالد).
  - **INSERT**: نفس الأدوار أعلاه + المستخدم الخاص بمحمد خالد. الحركة تُنشأ دائمًا بحالة `pending`.
  - **UPDATE (اعتماد/رفض/تعديل/حذف)**: `general_manager`, `executive_manager` فقط. `accountant` للقراءة فقط.
  - **DELETE**: `general_manager` فقط.

### Views
- `v_lab_treasury_balances`: رصيد لكل طريقة دفع + الإجمالي (من المعتمدة فقط) + رصيد تقديري شامل المعلقة.
- `v_lab_treasury_dashboard`: كروت اليوم/الشهر، إيرادات/مصروفات، صافي، أعلى بند، إجماليات التفريخ والكتاكيت.

## 2) الواجهة الأمامية

### صفحة جديدة `/lab-treasury` (مكوّن `src/pages/LabTreasury.tsx`)
تابات داخلية:
1. **Dashboard** — كل الكروت المطلوبة (إجمالي/نقدي/فودافون/إنستا/بنكي، يوم/شهر، أعلى بند، إيرادات التفريخ/الكتاكيت).
2. **إضافة إيراد** — Dialog أو نموذج جانبي (نوع الإيراد، عميل، عدد، سعر، إجمالي تلقائي، طريقة دفع، ملاحظات، رفع إيصال).
3. **إضافة مصروف** — نموذج (بند، مبلغ، طريقة دفع، وصف، مستفيد، إيصال).
4. **سجل الحركات** — جدول كشف حساب (تاريخ، نوع، بيان، وارد، منصرف، طريقة، رصيد بعد، مستخدم، حالة، ملاحظات، تفاصيل) + فلاتر كاملة (من/إلى، نوع، تصنيف، طريقة دفع، حالة، عميل، مستخدم).
5. **الاعتمادات** — للمدير فقط: الحركات المعلّقة + أزرار اعتماد/رفض (مع سبب رفض).
6. **التقارير** — اختيار النوع (يومي/شهري/فترة/إيرادات تفريخ/إيرادات كتاكيت/مصروفات حسب البند/حسب طريقة الدفع/كشف كامل/صافي تشغيل/رواتب) + تصدير Excel وPDF وطباعة (عبر `openPrintWindow` من `@/lib/printPdf` لدعم العربي).

### Validation
استخدام `zod` لكل النماذج (مبلغ > 0، تاريخ مطلوب، إلخ).

### Sidebar
إضافة عنصر واحد فقط في السايد بار تحت قسم "3. المعمل وتفريغ الكتاكيت":
- **"خزنة المعمل والحضانات"** → `/lab-treasury`
- الصلاحيات: `general_manager`, `executive_manager`, `accountant`, `financial_manager`, ومستخدم محمد خالد (نتعرف عليه إما بـ role جديد `lab_treasury_keeper` أو بـ profile مطابق). الأبسط: إضافة role جديد `lab_treasury_keeper` ضمن enum `app_role`، يُعطى لمحمد خالد.

### Route
في `src/components/AnimatedRoutes.tsx` نضيف:
```tsx
<Route path="/lab-treasury" element={<ProtectedRoute roles={[...]}><LabTreasury/></ProtectedRoute>} />
```

## 3) الاعتماد والرصيد

- كل INSERT يضع `status = pending` و`balance_after = null`.
- عند UPDATE إلى `approved`: trigger يحسب `balance_after` لتلك الحركة وكل الحركات المعتمدة الأحدث منها (ترتيب: `movement_date, created_at`).
- الـ View `v_lab_treasury_balances` تجمع `SUM` على الحركات المعتمدة per `payment_method` (income +، expense −).

## 4) التصدير

- Excel: `safeExcel` الموجود.
- PDF/طباعة: `openPrintWindow` من `@/lib/printPdf` (دعم RTL/العربي).

## 5) خطوات التنفيذ

1. Migration واحد: enums + جدول + triggers + views + storage bucket + RLS + grants + إضافة `lab_treasury_keeper` للـ `app_role` enum.
2. تحديث `useAuth` types (يتم تلقائيًا بعد regenerate types).
3. إنشاء `src/pages/LabTreasury.tsx` مع التابات الستة.
4. إنشاء `src/hooks/useLabTreasury.tsx` (fetch + mutations + realtime channel).
5. تحديث `SidebarMenuSections.tsx` و`AnimatedRoutes.tsx`.
6. تحديث memory index بإضافة سجل للخزنة.

## ملاحظات

- خزنة مستقلة تمامًا عن `hatchery_treasury_txns` الموجودة (لن نلمسها).
- كل الحركات تُسجّل المستخدم والتاريخ والوقت تلقائيًا.
- لا حذف بدون صلاحية مدير عام؛ الرفض يحتفظ بالسجل للتدقيق.
