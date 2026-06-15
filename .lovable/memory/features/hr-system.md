---
name: HR System (Phase 1)
description: Multi-phase HR module — Phase 1 done (employees, locations, transfers, audit). Phases 2-4 pending (attendance, advances, deductions, bonuses, payroll, settings, reports).
type: feature
---

# نظام شؤون الموظفين

## المرحلة 1 — تم ✅
**جداول:** `hr_work_locations`, `hr_employees`, `hr_employee_transfers`, `hr_audit_log`
**صفحات:** `/hr` (Dashboard), `/hr/employees`, `/hr/work-locations`
**سايد بار:** قسم "شؤون الموظفين" بين تقارير السوشيال والنظام
**الصلاحيات:** general_manager / executive_manager / hr_manager (إدارة كاملة) + accountant/financial_manager (قراءة الموظفين)
**تلقائي:** trigger `trg_hr_employees_location_change` ينشئ سجل نقل عند تغيير `current_location_id`

## المرحلة 2 — متبقي
سلف الموظفين بمنطق فصل الاعتماد عن الصرف من الخزنة:
- جدول `hr_advances` بحالات: `pending → approved → paid → deducted_from_salary / cancelled`
- "اعتماد" → يضيف على حساب الموظف فقط (لا حركة خزنة)
- زر منفصل "صرف من خزنة" → ينشئ `main_treasury_transactions` بمرجع `employee_advance_payment_{advance_id}` (UNIQUE لمنع التكرار)
- الخزنة الافتراضية: main_treasury_transactions
- الحضور والغياب: `hr_attendance` (UNIQUE employee_id + date)
- الخصومات: `hr_deductions`
- المكافآت/الإضافي: `hr_bonuses`

## المرحلة 3 — متبقي
- `hr_payroll_settings`, `hr_salary_statements` (UNIQUE employee_id+year+month), `hr_salary_payments`
- صفحة بيان الرواتب الشهري + dialog تفاصيل + dialog صرف
- صرف من main_treasury مع reference `salary_payment_{statement_id}`

## المرحلة 4 — متبقي
طباعة Arabic PDF عبر `openPrintWindow` + تصدير Excel + تقارير + Dashboard cards مفصلة.
