## Goal
Close the loop between the slaughterhouse and the meat factory so that cuts dispatched from a slaughter batch land in the real meat-factory raw inventory (`meat_factory_raw_items` / `meat_factory_inventory_moves`) — separate from the generic main warehouse — and are then consumed by manufacturing invoices.

## Current state (relevant findings)
- `slaughter_batch_outputs.destination` already supports `meat_factory` (CHECK constraint allows it).
- The distribution dialog in `src/pages/modules/Slaughterhouse.tsx` only exposes a branch selector — there's no row-level destination dropdown, so rows are always saved with `destination='branch'`.
- `SlaughterToMeatInbox` exists and calls RPC `receive_slaughter_batch_verified` → `receive_slaughter_output`, but that RPC writes to `inventory_items` / `inventory_movements` in a regular warehouse named "مصنع اللحوم", **not** to `meat_factory_raw_items` / `meat_factory_inventory_moves`. So manufacturing invoices can't actually see the stock.
- `meat_manufacturing_invoice_lines.item_id` already references `meat_factory_raw_items` (fixed in a previous migration).

## Changes

### 1. Distribution dialog — add destination picker (`src/pages/modules/Slaughterhouse.tsx`)
- Add a `destination` Select per row with three options: `warehouse` (المخزن الرئيسي), `meat_factory` (مصنع اللحوم), `branch` (فرع).
- Show the branch selector only when `destination='branch'`.
- Default new rows to `warehouse` instead of `branch`.
- Persist `destination` and clear `branch_id` when not branch.

### 2. New RPC `receive_slaughter_output_to_meat_factory(p_output_id uuid)`
- Auth: `general_manager`, `executive_manager`, `meat_factory_manager`, `warehouse_supervisor`.
- Validates `destination='meat_factory'`, `received_status<>'received'`, `quality_status='accepted'`.
- Duplicate guard: unique index on `meat_factory_inventory_moves(ref_table='slaughter_batch_outputs', ref_id=output_id, direction='IN')`.
- Upserts a `meat_factory_raw_items` row by name with `kind='raw'`, `unit='كجم'`.
- Computes weighted-average `avg_cost` and updates `current_stock`.
- Inserts `meat_factory_inventory_moves` with `direction='IN'`, `reason='وارد من المجزر'`, `ref_table='slaughter_batch_outputs'`, `ref_id=output_id`, and `stock_before` / `stock_after`.
- Marks the output `received_status='received'`, sets `received_warehouse_id=NULL`, `received_by`, `received_at`.
- Writes a `slaughter_audit_log` row.

### 3. Update `SlaughterToMeatInbox` (`src/components/meat/SlaughterToMeatInbox.tsx`)
- Stop requiring a warehouse pick when receiving — call the new RPC per accepted output (loop or new batch RPC `receive_slaughter_batch_to_meat_factory`).
- Show toast with count + total kg.

### 4. Manufacturing invoice (already wired)
- Existing approval RPC consumes from `meat_factory_raw_items` via `meat_factory_inventory_moves` (`uq_meat_moves_mfg_invoice_item` unique guard). No code change needed, but verify the read dropdown filters by `is_active`.

### 5. Meat factory raw inventory screen
- Reuse `src/pages/meat/MeatWarehouses.tsx`. Add columns: balance × avg_cost = value, last "وارد من المجزر" date, last "صرف تصنيع" date, low-stock badge.
- Filters: kind tabs (raw / spice / packaging), movement source (slaughter / purchase / mfg out).

### 6. Meat factory dashboard (`src/pages/meat/MeatFactoryOverviewDashboard.tsx`)
- Cards: stock value (raw, spice, packaging, total), this-month in-from-slaughter kg + value, this-month purchases value, this-month consumed-for-mfg value, mfg invoice count, total mfg cost, products produced (count + kg).
- Section "إنتاج مصنع اللحوم من أول الشهر" table grouped by `meat_manufacturing_invoices.product_name`.
- Use Cairo TZ via `@/lib/cairoDate` for month boundaries.

### 7. Reports
- Three reports in `src/pages/meat/` (or inline tabs on dashboard): inbound-from-slaughter, mfg consumption, monthly production, stock value. Each with print (via `openPrintWindow`) and Excel export (`xlsx`).

### 8. RLS / permissions
- `meat_factory_inventory_moves` and `meat_factory_raw_items` already restrict insert to `meat_factory_manager` and admins; nothing new needed beyond granting the RPC.

## Tests after implementation
1. Edit a slaughter batch → set one row's destination to "مصنع اللحوم" with 10 kg "لحم نعام فرم" → save.
2. Open مصنع اللحوم → Inbox → استلام → confirm stock added to `meat_factory_raw_items` only (not main warehouse).
3. Create a manufacturing invoice that consumes 5 kg "لحم نعام فرم" → approve → stock decreases by 5.
4. Dashboard shows month-to-date inbound-from-slaughter, consumption, products produced.
5. Re-run RPC on the same output → returns "already received" without double-adding.

## Reporting back
After tests I'll report: batch # used, item, qty in/out, stock before/after, dashboard month totals, duplicate guard confirmation.

---

This is sizeable (1 migration + ~6 file edits). Reply **approve** and I'll start with the migration.