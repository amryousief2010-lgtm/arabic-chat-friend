# Inventory ledger contract

`inventory_movements` is the only stock history. `inventory_items.stock` is the balance (the owner calls this `current_stock`; the column name is `stock`). Nothing else may change that balance.

## Rules for every app section, including Lovable's agent

1. Never `UPDATE inventory_items.stock` from client code, an edge function, or an ad-hoc script.
2. Never `INSERT`, `UPDATE`, or `DELETE` `inventory_movements` from client code. Posted rows are immutable.
3. Post stock only by calling `post_inventory_movement` (or a wrapper that calls it: `post_manual_inventory_movement`, `post_purchase_in_packs`, `post_waste_movement`, `post_outlet_sale`, `post_production_movement`, `post_packaging_consumption`, `set_inventory_item_stock`, `approve_stocktaking_session`, `_dispatch_order_stock_core`).
4. Every new movement has `(source_type, source_id, source_line_id)`. The same triple cannot post twice. A retry returns `already_posted` and does not move stock.
5. A correction is `reverse_posted_inventory_movement(id, reason)`. Do not delete or edit the original row.
6. Quantities are kilograms. A purchase in packs is converted with `pack_weight_kg` (default 0.5; دبوس بالعظم 6; دهن 1).
7. One card per `(warehouse_id, product_id)` where `product_id` is not null. The unique index `inventory_items_wh_product_unique` already exists and is valid. Do not drop it. Do not run `merge_duplicate_inventory_cards(true)` until the owner approves `report_duplicate_inventory_cards()`.
8. Order deduction uses `orders.source_warehouse_id` for every warehouse. A line with no linked card is a failed `order_deduction_lines` row, not a silent skip. Deduction runs on delivery, one movement per order line, and respects the period lock using `delivered_at`.
9. The period lock is created only when a stocktake is approved at or after `2026-09-30 00:00 Africa/Cairo`. Do not backfill locks. An earlier movement is rejected. Only `general_manager` or `executive_manager` may override, with a written reason that is stored on the movement.
10. Costs (`inventory_movements.unit_cost`, `inventory_movements.total_cost`, `inventory_items.unit_cost`, `products.cost_price`) are visible only to `general_manager`, `executive_manager`, `accountant`, `financial_manager`, and `cost_accountant`. There is no `admin` role. Sale `products.price` stays readable. Read product cost through `product_cost_price` or `product_cost_prices`. Write it through `set_product_cost_price`. Do not `GRANT SELECT ON TABLE` for `inventory_movements`, `inventory_items`, or `products`: that re-grants every column, including cost. `scripts/check_ledger_stock_writers.sql` fails CI if anon or authenticated can select those cost columns.
11. Who may receive a transfer is `warehouse_role_grants` by warehouse id, not by warehouse name. General manager and executive manager may receive any warehouse.
12. Do not change offer-box shipping, `orders.created_by` (the marketer), or order totals in inventory work.
13. `scripts/check_inventory_client_writes.py` fails CI if client or edge code writes the ledger tables directly. `scripts/check_ledger_stock_writers.sql` fails CI if any function other than the ledger assigns `inventory_items.stock`.

## Source types

`order_delivery`, `order_return`, `transfer_out`, `transfer_in`, `stocktake`, `opening_balance`, `purchase`, `waste`, `production`, `packaging_consumption`, `manual_in`, `manual_out`, `manual_adjustment`, `outlet_sale`, `reversal`.

Legacy rows with null source keys stay in the table. They are history. The reconciliation baseline starts at the 30 September 2026 stocktake per warehouse. Absolute adjustments without `stock_before` / `stock_after` are excluded from that sum.

## Session flags

`post_inventory_movement` sets `app.inventory_stock_write` and `app.inventory_ledger_posted` for the current transaction only. A client cannot set them through the API. Do not clear `app.inventory_stock_write` inside a trigger: a sibling trigger would turn it off before the guard runs. The guard trigger is named `trg_00_reject_direct_inventory_stock_write` so it runs first.

## Compatibility bridge

Some older SQL functions still `INSERT` a movement. A migration stamps `app.inventory_ledger_posted` and `app.inventory_bridge_insert` at the start of those functions. The apply trigger updates stock once when the row has no snapshots, and only while `app.inventory_apply_stock` is on. If that same function also assigns `inventory_items.stock`, the guard raises `DOUBLE_COUNT` and the transaction rolls back. New work must call `post_inventory_movement` and must not insert a movement itself.

`meat_factory_raw_items.current_stock` changes only inside `post_meat_raw_movement`. Finished-goods cards (`meat_factory_finished_items`, `meat_factory_products`) and `meat_factory_raw_materials.stock` are still separate balances.
