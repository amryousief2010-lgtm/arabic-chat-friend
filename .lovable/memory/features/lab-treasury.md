---
name: Lab & Brooding Treasury
description: Independent treasury at /lab-treasury for hatchery+brooding income/expenses with approval workflow, payment-method balances, and reports
type: feature
---
- Route: `/lab-treasury` (page `src/pages/LabTreasury.tsx`)
- Owner: محمد خالد — granted role `lab_treasury_keeper`
- Table: `public.lab_treasury_movements` with enums `lab_treasury_payment_method` (cash/vodafone_cash/instapay/bank_transfer), `lab_treasury_movement_type`, `lab_treasury_status` (pending/approved/rejected), `lab_treasury_income_category`, `lab_treasury_expense_category`
- Approval: new rows always inserted as `pending`. Only `general_manager`/`executive_manager` can update status. `balance_after` is recomputed by `lab_treasury_recalc_balances()` trigger on approved rows only.
- Visibility: GM, executive, accountant, financial_manager, lab_treasury_keeper, or row owner.
- Delete: GM only.
- Storage bucket `lab-treasury-receipts` (private) for receipt files.
- Views: `v_lab_treasury_balances`, `v_lab_treasury_dashboard`.
- Independent of `hatchery_treasury_txns` (not mixed).
