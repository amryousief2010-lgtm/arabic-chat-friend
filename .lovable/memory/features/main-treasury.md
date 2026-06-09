---
name: Main Treasury (Company)
description: Slaughterhouse "Main Company Treasury" managed by Mohamed Sho'la — funds custody treasury and approves large expenses with formal approval workflow
type: feature
---
# الخزنة الرئيسية للشركة (مجزر)

خزنة منفصلة عن خزنة العهدة، يديرها المحاسب **محمد شعلة**.

## الأدوار
- `main_treasury_accountant` — محمد شعلة، ينشئ الحركات
- `main_treasury_approver` — يعتمد، إضافة للمدير العام/التنفيذي/المالي
- `slaughterhouse_custody_keeper` — يستلم التحويلات الواردة من الخزنة الرئيسية

## الجداول
- `main_treasury_accounts` — حسابات نقدية/بنكية/محافظ
- `main_treasury_transactions` — سجل الحركات بـ reference_no تلقائي (`MT-YYYY-NNNNNN`)
- `main_treasury_expense_categories` — بنود مصروفات (rent/salaries/major_maintenance/assets/utilities/transport/taxes/legal/insurance/marketing/custody_topup/other)
- `main_treasury_approval_rules` — قواعد الاعتماد بالحد
- `main_treasury_to_custody_transfers` — جسر مع خزنة العهدة (sent → received)
- `main_treasury_audit_log` — كل تغيير حالة
- `v_main_treasury_balance` — view للرصيد الحالي

## قواعد الاعتماد (Approval Rules)
- ≤ 5,000 ج → posted تلقائيًا
- 5,000.01 – 50,000 ج → اعتماد واحد
- > 50,000 ج → **اعتماد مزدوج** من معتمدَين مختلفين

## RPCs
- `mt_approve_txn(p_txn_id)` — يعتمد، يدعم الاعتماد المزدوج
- `mt_reject_txn(p_txn_id, p_reason)` — يرفض مع سبب إجباري
- `mt_receive_custody_transfer(p_transfer_id)` — أمين العهدة يثبت الاستلام

## القواعد الثابتة
- لا تُخصم المعاملة من الرصيد إلا في حالة `posted`
- لا يُسمح بتعديل الحقول المالية بعد `approved/posted/reversed` (trigger guard)
- التحويل لخزنة العهدة لا يدخل رصيد العهدة إلا بعد الاستلام (double-entry)
- كل عملية لها سند طباعة عربي RTL عبر `openPrintWindow`

## المسار والصفحة
- مسار: `/main-treasury`
- صفحة: `src/pages/MainTreasury.tsx`
- مرئي تحت قسم "5. المجزر" في الـ Sidebar
