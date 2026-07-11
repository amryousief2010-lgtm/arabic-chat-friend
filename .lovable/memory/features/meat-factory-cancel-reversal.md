---
name: Meat Factory Invoice Cancellation Reversal (LOCKED)
description: Any cancelled meat manufacturing invoice must return quantities to warehouse
type: feature
---

# Meat Manufacturing Invoice Cancellation — LOCKED

- Function `cancel_meat_manufacturing_invoice` MUST always reverse stock (return raw materials, deduct produced products) for any posted invoice.
- Draft invoices skip reversal because they never deducted stock in the first place.
- Do not remove or bypass the reversal logic under any circumstances.
