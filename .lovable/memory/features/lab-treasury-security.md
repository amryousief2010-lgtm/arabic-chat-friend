---
name: Lab Treasury Security
description: Hardened lab treasury (محمد خالد) — audit log, day closures, balance guard, mandatory reasons for reject/delete
type: feature
---
# خزنة المعمل والحضانات - المرحلة 2 (التأمين)

## القواعد
- الرصيد الرسمي = حركات `status='approved'` فقط (view: `v_lab_treasury_balances.balance_approved`).
- الرصيد التقديري = approved + pending (`balance_estimated`).
- المصروف لا يتجاوز الرصيد لنفس `payment_method` إلا للمدير العام/التنفيذي (trigger `lab_treasury_check_expense_balance`).
- الرفض إلزامي بسبب ≥ 3 أحرف؛ يملأ `rejected_by/rejected_at` تلقائياً (trigger `lab_treasury_guard_changes`).
- الحذف مقصور على GM + Executive، يستلزم سبب، ويُسجل قبل التنفيذ في `lab_treasury_audit_log`.
- تعديل أي حركة `status='approved'` ممنوع لغير GM/Executive.
- أي يوم في `lab_treasury_day_closures` (بدون `reopened_at`) يصبح read-only للجميع عدا GM/Executive.
- إعادة فتح يوم مقفل: GM فقط، مع سبب موثق.

## الجداول
- `lab_treasury_movements` — أضيف: `rejected_by`, `rejected_at`, `deletion_reason`, `edit_reason`.
- `lab_treasury_day_closures` — صور يومية بأرصدة 4 طرق دفع + opening/closing.
- `lab_treasury_audit_log` — كل إجراء: insert_income, insert_expense, approve, reject, delete, close_day, reopen_day, export_excel, export_pdf, print_report, print_census.

## RPC
- `public.lab_treasury_daily_report(p_date date)` → jsonb: opening/income/expense/net/closing/pending_count/rejected_count/by_method.

## الواجهة (`/lab-treasury`)
- تبويبات: لوحة، إيراد، مصروف، سجل الحركات، الاعتمادات، التقرير اليومي، إقفال الأيام، التقارير، سجل التدقيق (للمدراء).
- زر "محضر جرد الخزنة" بأعلى الصفحة + داخل التقارير.
- نموذج المصروف يعرض الرصيد المتاح ويمنع الحفظ للمصروف المتجاوز إن لم يكن المستخدم مديراً.
