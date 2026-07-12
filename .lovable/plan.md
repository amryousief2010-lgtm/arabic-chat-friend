
# بيع نعام قائم — Live Ostrich Sale

Standalone operation, independent from the slaughter pipeline. Sold birds never enter batch/yield calculations.

## 1. Database

New migration adds one table + one view + a helper function:

**`slaughter_live_sales`** (public)
- `id`, `sale_number` (unique, auto `LS-YYYYMMDD-XXXX`)
- `sale_date` (date)
- `live_receipt_id` (FK → slaughter_live_receipts)
- `live_bird_id` (FK → slaughter_live_birds, nullable — null when receipt has no per-bird records)
- `bird_count` (int, default 1)
- `sale_weight_kg` (numeric)
- `price_per_kg` (numeric)
- `total_sale` (generated: weight × price)
- `unit_cost_at_sale` (numeric) — snapshot of cost/kg used
- `total_cost_at_sale` (numeric) — snapshot bird cost + expense share
- `breakeven_per_kg` (numeric) — snapshot
- `net_profit` (generated: total_sale − total_cost_at_sale)
- `cost_source` — `'per_bird'` or `'batch_average'`
- `customer_name`, `customer_phone`, `payment_method` (`cash|credit|partial`), `amount_paid`, `notes`
- `created_by`, `created_at`, `updated_at`

RLS: view = all authenticated. Manage = general_manager, executive_manager, slaughterhouse_manager.

**`v_available_live_ostrich`** — view that returns per-receipt availability:
- receipt fields + `sold_live_count`, `sold_live_weight_kg`, `available_count` = `current_alive_count − sold_live_count`.

**Trigger** on `slaughter_live_sales` INSERT: decrement `slaughter_live_receipts.current_alive_count` and `manual_available_adjustment` bookkeeping so the sold birds disappear from "available for slaughter" lists. Reverse on DELETE.

Sold birds are excluded from cost allocations by:
- If per-bird sale (has `live_bird_id`), the bird row is soft-flagged via `notes` and excluded in existing yield calc queries via LEFT JOIN on live_sales.
- Yield/تصافي code already uses batches — no change needed because sold live birds never enter a batch.

## 2. Frontend

New tab inserted in `src/pages/modules/Slaughterhouse.tsx` between `دفعات الذبح` and `استلام حي`:

```
<TabsTrigger value="live-sales">بيع نعام قائم</TabsTrigger>
```

New file `src/components/slaughterhouse/LiveOstrichSalesTab.tsx`:
- Header + `+ بيعة قائمة جديدة` button
- Table columns: `#`, `التاريخ`, `الدفعة`, `عدد النعام`, `وزن البيع`, `سعر/كجم`, `التكلفة`, `إجمالي البيع`, `الربح`, `الحالة`

New file `src/components/slaughterhouse/NewLiveSaleDialog.tsx`:
- Select **الدفعة المشتراة** (receipts with `available_count > 0`)
- Select **النعامة** (from `slaughter_live_birds` not yet sold/slaughtered) — optional if no per-bird records; then user enters count instead
- **وزن البيع القائم** (numeric, prefilled with last known live weight, editable)
- **سعر بيع الكيلو**
- **تاريخ البيع** (default today)
- **العميل** + **طريقة السداد** (cash/credit/partial + amount_paid)
- **نسبة ربح مستهدفة %** — optional; when filled, suggests `price/kg = breakeven × (1 + margin)`

**Live calculation card** (recomputes on every change):

```
تكلفة شراء النعامة:        X ج.م
نصيبها من المصروفات:       Y ج.م
إجمالي التكلفة حتى اليوم:  X+Y ج.م   (تكلفة تقديرية من متوسط الدفعة — لو batch_average)
سعر التعادل للكيلو:        (X+Y) ÷ وزن البيع
إجمالي البيع:              وزن البيع × السعر
صافي الربح:                إجمالي البيع − إجمالي التكلفة
الربح في الكيلو / النسبة:  ...
```

**Cost calculation logic** (client, using data already loaded):
- **Per-bird**: `unit_cost = bird.purchase_cost + bird.feed_cost + (receipt.other_costs_loaded × bird.live_weight / receipt.total_weight_kg)`
- **Batch average fallback** (no `slaughter_live_birds` or bird has zero cost): `cost_per_kg_current = receipt.total_batch_cost / max(remaining_live_weight, 1)` then `unit_cost = sale_weight × cost_per_kg_current`. Label the number in the UI as "تكلفة تقديرية من متوسط الدفعة".

On save:
- Insert `slaughter_live_sales` with snapshot values.
- Trigger auto-decrements `current_alive_count`.
- Toast + refresh.

## 3. Routing / Permissions

- No new route; tab lives inside existing `/modules/slaughterhouse`.
- Write access: general_manager, executive_manager, slaughterhouse_manager (same as receipts). Read: all authenticated.

## 4. Non-goals

- No integration with slaughter batch outputs, yield, or transfers.
- No inventory movement in warehouses (bird leaves as-is).
- No treasury auto-posting in this iteration (customer + payment stored for later reconciliation).

## Technical notes

- Cairo-date helpers (`cairoTodayStartUTC`) already used elsewhere — apply to `sale_date` filters in the tab.
- All monetary formulas run in Postgres generated columns; UI shows live preview only.
- Existing "available for slaughter" query in `slaughterhouse` intake screens uses `current_alive_count`, so once trigger fires the sold ostrich disappears automatically without extra code.
