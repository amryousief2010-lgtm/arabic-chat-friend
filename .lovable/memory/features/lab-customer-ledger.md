---
name: Lab Customer Ledger
description: Hatchery lab customer statement of account — debits from batch results, credits from lab_treasury collections, historical closeout for op_batch ≤15
type: feature
---
- Table `public.lab_customer_ledger` — one row per movement; unique (source_type, source_id, customer_id).
- Pricing (locked): infertile 50, candle2_dead 100, chick 150, brooding 10/chick/day.
- Auto-debits via trigger `trg_hatch_batch_to_ledger` when `hatch_batches.status='completed'` (skips is_test and NULL customer). Updates same row on re-edit.
- Auto-credits via trigger `trg_lab_treasury_to_ledger` when `lab_treasury_movements` is income+approved and `customer_name` matches a `hatch_customers.name` (case/trim). Approval changes recompute, deletion removes.
- `lab_ledger_recompute_balance(customer)` recalculates `running_balance` ordered by entry_date,created_at,id. AFTER trigger `trg_lab_ledger_aft` uses `pg_trigger_depth()>1` guard to prevent recursion + writes to `lab_customer_ledger_audit`.
- View `v_lab_customer_balances` summarizes balances with status: outstanding / partially_paid / settled / credit_balance / no_activity.
- Historical closeout: any customer with batch op_no≤15 had remaining debt auto-settled with `entry_type='historical_closeout'`, `payment_method='historical_settlement'` (does NOT enter cash treasury).
- Pages: `/lab-treasury/customer-statement` (per-customer details + PDF/CSV) and `/lab-treasury/customer-balances` (all customers grid).
- العاصمة customer treated like any other (linked through normal name match).
