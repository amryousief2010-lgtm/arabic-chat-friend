---
name: Slaughterhouse Custody Treasury
description: Independent custody/petty-cash treasury for Mohammed Shola at /slaughterhouse-custody — daily slaughterhouse expenses, weekly limit, full approval workflow
type: feature
---
- Route: `/slaughterhouse-custody` (page `src/pages/SlaughterhouseCustody.tsx`)
- Role: `slaughterhouse_custody_keeper` — granted to محمد شعلة (`d1d37093-182a-4ee9-932c-d2a2b45f33ec`)
- Tables: `slaughter_custody_expenses` (status enum pending_review/clarification_needed/approved/rejected/over_limit_pending), `slaughter_custody_opening_balances`, `slaughter_custody_weekly_limits`, `slaughter_custody_comments`, `slaughter_custody_week_closures`, `slaughter_custody_audit_log`
- Views: `v_slaughter_custody_balance` (current = approved openings − approved expenses), `v_slaughter_custody_week_usage` (current Monday-start week limit/approved/pending)
- Trigger `slaughter_custody_set_status`: auto-sets week_start_date and flips status to `over_limit_pending` when amount exceeds remaining weekly limit
- Audit trigger fires on every INSERT/UPDATE/DELETE for expenses/limits/closures/comments/openings
- Storage bucket `slaughter-custody-receipts` (private). Shola uploads to `{user_id}/...`; sees only own files; management sees all
- RLS:
  - Shola: SELECT/INSERT only his own expenses; INSERT comments only on his expenses (replies). NO update/delete/approve
  - Managers (`general_manager`, `executive_manager`, `lab_treasury_approver` السيد الجمل, `slaughterhouse_manager`): full review/approve/reject/clarify, set limits, manage openings, audit log
  - Only GM/Executive can reopen closed weeks
- **Strictly separate** from `lab_treasury_*` (خزنة المعمل والحضانات). Shola's lab collections still flow via `lab_treasury_external_collections` / `/my-lab-collections` — that's unrelated to custody expenses.
- Sidebar entry under "5. المجزر وإنتاج اللحوم"
