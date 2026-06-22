---
name: Meat Factory Carryover Dough
description: Leftover dough from manufacturing invoices stored as balance, used manually in later invoices without re-deducting raw materials
type: feature
---
Tables: `meat_factory_carryover_dough` (id, source_invoice_id/no, source_product_name, original_qty_kg, remaining_qty_kg, unit_cost, total_value generated, status [available|partial|used|damaged], damaged_*), and `meat_factory_carryover_dough_usage` (carryover_id, used_in_invoice_id/no, used_qty_kg, unit_cost_at_use).

Flow in `src/pages/meat/ManufacturingInvoices.tsx`:
- "يوجد عجينة متبقية" toggle → inserts row into carryover_dough on save. unit_cost = (raw+spice+pack) / (finished_qty + carryover_out_qty). Leftover is NOT added to finished stock and NOT counted as waste.
- "استخدام عجينة مرحلة" dropdown (manual choice only) lists status in (available, partial) + remaining>0. On save: inserts usage row, decrements remaining_qty_kg, sets status to 'used' (≤0) or 'partial'. Cost (qty × unit_cost) is added to invoice `extra_cost` — raw materials are NOT re-deducted.

Page `src/pages/meat/CarryoverDough.tsx` at `/meat-factory/carryover-dough` lists balances + usage history. "إعدام" button is restricted to general_manager/executive_manager via `useAuth().roles`; sets status='damaged', remaining=0, records damaged_by/at/reason.

No treasury, no purchase invoice, no auto-modification of old invoices.
