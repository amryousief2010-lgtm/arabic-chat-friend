---
name: Lab Treasury Openings & External Collections
description: Opening balances + external (holder/wallet) collections feature for Hatchery & Brooding Treasury
type: feature
---
Tables: `lab_treasury_opening_balances` (per-method amounts, status pending/approved/rejected, manager approval), `lab_treasury_external_collections` (holder_name, payment_method, amount, source: hatching/chick_sales/general/other, deposited_amount, status: not_deposited/partially_deposited/fully_deposited), `lab_treasury_external_deposits` (creates pending lab_treasury_movements via trigger `lab_external_after_deposit`).

External money never counted in official balance until deposit is approved as a regular treasury movement. Dashboard shows: official balance, estimated, outstanding external (عُهَد), total lab funds = official + outstanding.

UI: tabs "الأرصدة الافتتاحية" and "التحصيلات الخارجية" in `src/pages/LabTreasury.tsx`. Components in `src/pages/lab-treasury/LabTreasuryExtras.tsx`.
