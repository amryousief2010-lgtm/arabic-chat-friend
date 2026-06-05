# خطة تأمين خزنة المعمل والحضانات

## 1. قاعدة البيانات (Migration واحد)

### أعمدة جديدة على `lab_treasury_movements`
- `rejected_by uuid`, `rejected_at timestamptz` (الموجود حالياً `rejection_reason` فقط)
- `deleted_at timestamptz`, `deleted_by uuid`, `deletion_reason text` (soft-delete اختياري — لكن سياسة الحذف فعلية مع Audit)
- `is_day_closed boolean default false`

### جدول جديد `lab_treasury_day_closures`
- `closure_date date unique`, `closed_by uuid`, `closed_at timestamptz`
- `opening_balance numeric`, `closing_balance numeric`
- `cash_balance, vodafone_balance, instapay_balance, bank_balance numeric`
- `total_income, total_expense, net_movement numeric`
- `notes text`

### جدول جديد `lab_treasury_audit_log`
- `action text` (insert_income, insert_expense, approve, reject, delete, update, export_excel, export_pdf, print_report, close_day, reopen_day)
- `movement_id uuid nullable`, `actor_id uuid`, `actor_name text`
- `before_data jsonb`, `after_data jsonb`, `reason text`
- `created_at timestamptz default now()`
- `ip_address text nullable`

### تشديد RLS لـ `lab_treasury_keeper`
- INSERT: مسموح، لكن `status` يُجبر = `pending` و `approved_by/at` null
- UPDATE: ممنوع تماماً (مع trigger يمنع تعديل أي شيء بعد الاعتماد لأي دور غير GM/Executive)
- DELETE: ممنوع
- لا يرى إلا حركات `lab_treasury_movements`

### Trigger `lab_treasury_guard_update`
- يمنع UPDATE لأي حركة `status='approved'` إلا من GM/Executive
- يمنع UPDATE/DELETE لأي حركة يومها مُقفل إلا من GM/Executive
- عند الرفض: يُلزم بـ `rejection_reason` غير فارغ ويملأ `rejected_by/at`
- عند الحذف: يُلزم بـ `deletion_reason` ويسجل في Audit Log

### Trigger `lab_treasury_check_balance`
- على INSERT لمصروف: يتحقق أن `amount` ≤ الرصيد المعتمد لنفس `payment_method`
- إذا كان المستخدم ليس GM/Executive ⇒ يرفض
- إذا GM/Executive ⇒ يسمح (تحذير على الواجهة فقط)

### Views محدّثة
- `v_lab_treasury_balances`: يعيد `official_balance` (approved فقط) و `estimated_balance` (approved + pending) لكل طريقة دفع
- `v_lab_treasury_daily_report(date)`: function ترجع تقرير يوم كامل

### GRANTs
- جداول جديدة لـ `authenticated` + `service_role`

## 2. الواجهة الأمامية

### تعديلات على `src/pages/LabTreasury.tsx`
- **Dashboard tab**: كاردات منفصلة للرصيد الرسمي vs التقديري + breakdown بطرق الدفع
- **AddExpense**: تحقق فوري من الرصيد، إظهار تحذير عند التجاوز، منع الحفظ لغير GM/Executive
- **Approvals**: نافذة رفض إلزامية لسبب الرفض
- **Ledger**: زر حذف يفتح dialog يطلب سبب الحذف (للـ GM/Executive فقط)
- **تبويب جديد "إقفال اليوم"**: قائمة الأيام، زر إقفال (GM/Executive)، عرض الأيام المقفلة
- **تبويب "التقرير اليومي"**: اختيار التاريخ + كل الحقول المطلوبة
- **زر "محضر جرد خزنة"**: PDF عبر `openPrintWindow` يحوي كل الأرصدة + خانتي توقيع
- **تبويب "سجل التدقيق Audit"**: للـ GM/Executive فقط

### Hook `useLabTreasury.tsx`
- تسجيل كل عملية في `lab_treasury_audit_log` عبر دوال wrapper
- دوال: `approveMovement(reason?)`, `rejectMovement(reason)`, `deleteMovement(reason)`, `closeDayClosure(date)`, `exportExcel/PDF` (تسجل في Audit)

## 3. الصلاحيات النهائية

| العملية | keeper | accountant | executive | general_manager |
|---|---|---|---|---|
| عرض | ✅ | ✅ | ✅ | ✅ |
| إضافة إيراد/مصروف | ✅ (pending) | ❌ | ✅ | ✅ |
| رفع إيصال | ✅ | ❌ | ✅ | ✅ |
| اعتماد | ❌ | ❌ | ✅ | ✅ |
| رفض (مع سبب) | ❌ | ❌ | ✅ | ✅ |
| حذف (مع سبب) | ❌ | ❌ | ✅ | ✅ |
| تعديل بعد الاعتماد | ❌ | ❌ | ✅ | ✅ |
| تجاوز الرصيد | ❌ | ❌ | ✅ | ✅ |
| إقفال اليوم | ❌ | ❌ | ✅ | ✅ |
| فتح يوم مقفل | ❌ | ❌ | ❌ | ✅ |
| Audit Log | ❌ | عرض | ✅ | ✅ |

## 4. القواعد الذهبية
- الرصيد الرسمي = approved فقط (لا يدخل pending أبداً)
- كل حدث = سطر في Audit Log
- أي حركة يومها مُقفل = read-only للجميع عدا GM/Executive
- لا خلط مع `hatchery_treasury_txns` أو `mf_treasury` أو أي خزنة أخرى

سأبدأ بـ Migration واحد شامل ثم تحديث الواجهة في خطوة ثانية.
