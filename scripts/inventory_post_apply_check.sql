-- Post-apply check for the inventory ledger. Read-only, except it raises
-- when the mechanism itself is missing.
--
-- Before applying the migrations, run only the checksum query below and save
-- the rows. After applying, run this whole file. The checksum must match
-- unless a movement was posted during the apply window.

-- inventory_stock_checksum
SELECT i.warehouse_id,
       w.name AS warehouse_name,
       count(*) AS cards,
       round(COALESCE(sum(i.stock), 0), 3) AS stock_kg,
       md5(string_agg(i.id::text || ':' || COALESCE(i.stock, 0)::text, ',' ORDER BY i.id)) AS checksum
  FROM public.inventory_items i
  LEFT JOIN public.warehouses w ON w.id = i.warehouse_id
 GROUP BY i.warehouse_id, w.name
 ORDER BY w.name NULLS LAST, i.warehouse_id;

DO $post$
BEGIN
  IF to_regprocedure('public.post_inventory_movement(uuid, text, numeric, text, uuid, text, text, text, timestamptz, numeric, text, text, text, boolean, uuid, uuid, text, uuid, text, text, text, uuid, numeric, numeric, uuid)') IS NULL THEN
    RAISE EXCEPTION 'missing post_inventory_movement';
  END IF;
  IF to_regprocedure('public.inventory_reconciliation_check(integer)') IS NULL THEN
    RAISE EXCEPTION 'missing inventory_reconciliation_check';
  END IF;
  IF to_regprocedure('public.post_meat_raw_movement(uuid, text, numeric, numeric, text, text, uuid, text, text, numeric, numeric, text)') IS NULL THEN
    RAISE EXCEPTION 'missing post_meat_raw_movement';
  END IF;
  IF to_regprocedure('public.post_outlet_sale(uuid, numeric, text, uuid, text, text, timestamptz, text)') IS NULL
     OR to_regprocedure('public.save_outlet_sales_statement(uuid, uuid, date, text, jsonb)') IS NULL
     OR to_regprocedure('public.post_outlet_sales_statement(uuid, text)') IS NULL
     OR to_regprocedure('public.reverse_outlet_sales_statement(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'missing outlet sales statement functions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_00_reject_direct_inventory_stock_write'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'stock guard trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_00_reject_direct_inventory_movement_write'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'movement immutability trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_00_reject_direct_meat_raw_stock'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'meat raw stock guard is missing';
  END IF;
  IF has_table_privilege('authenticated', 'public.inventory_movements', 'INSERT')
     OR has_table_privilege('authenticated', 'public.inventory_movements', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.inventory_movements', 'DELETE')
     OR has_table_privilege('anon', 'public.inventory_movements', 'INSERT')
  THEN
    RAISE EXCEPTION 'authenticated/anon still has a write grant on inventory_movements';
  END IF;
  IF has_column_privilege('authenticated', 'public.inventory_movements', 'unit_cost', 'SELECT')
     OR has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT')
     OR has_column_privilege('anon', 'public.products', 'cost_price', 'SELECT')
  THEN
    RAISE EXCEPTION 'cost column is visible to anon or authenticated';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.products', 'price', 'SELECT') THEN
    RAISE EXCEPTION 'sale price is hidden';
  END IF;
END
$post$;

SELECT check_code, count(*) AS rows
  FROM public.inventory_reconciliation_check(3)
 GROUP BY check_code
 ORDER BY check_code;

SELECT * FROM public.report_duplicate_inventory_cards();

SELECT w.name AS warehouse_name, g.warehouse_id, g.role::text, g.capability
  FROM public.warehouse_role_grants g
  JOIN public.warehouses w ON w.id = g.warehouse_id
 ORDER BY w.name, g.role::text, g.capability;
