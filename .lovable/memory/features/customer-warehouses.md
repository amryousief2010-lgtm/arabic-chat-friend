---
name: Customer Warehouses (Independent)
description: Hyper Healthy Test & Carrefour are independent warehouses; supply/issue happens directly into/from each (no Main-warehouse linkage)
type: feature
---
Hyper Healthy Test (هايبر هيلثي تيست) and Carrefour (هايبر كارفور) are independent warehouses just like Agouza and Main.

Per-warehouse pages at `/warehouse-stock/hyper-healthy-test` and `/warehouse-stock/hyper-carrefour` use `WarehouseStockView` with `scope="healthy"` / `scope="carrefour"` (NOT `CustomerWarehouseView`).

Each warehouse view shows:
- KPI cards scoped to that warehouse only (قيمة المخزون، عدد الأصناف، منخفضة، آخر حركة، أصناف لها رصيد فعلي، إجمالي محجوز، أصناف محجوز أكثر من الفعلي)
- Same `إضافة رصيد / توريد مباشر` and `صرف منتجات / توريد للجهات` buttons as Main
- Multi-item operations via `ManualStockAdditionDialog` / `ManualStockOutDialog` (already generic via `warehouseId` + `warehouseName` props)

Add increases this warehouse only. Issue decreases this warehouse only. No internal transfer to/from Main. No treasury or invoice side-effects.

Items table is hidden by default and only shown when the user clicks a KPI card.
