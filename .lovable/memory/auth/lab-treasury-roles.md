---
name: Lab Treasury Roles
description: Three roles around the Hatchery & Brooding Treasury — keeper, external collector, approver
type: feature
---
- `lab_treasury_keeper` (محمد خالد): full visibility of lab treasury + insert income/expense + record deposits, NO approve/reject/delete, NO reopen day.
- `lab_external_collector` (محمد شعلة): only `/my-lab-collections`. Sees ONLY own external collections + can register own collections and submit deposit requests. Cannot see expenses, salaries, other holders, full treasury.
- `lab_treasury_approver` (السيد الجمل): approves/rejects all lab treasury movements + opening balances + external deposits; sees audit log + reports. Cannot delete movements or reopen closed days (only GM can).
