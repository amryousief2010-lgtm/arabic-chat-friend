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
  IF to_regprocedure('public.close_legacy_doc_by_stocktake(text, uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'missing close_legacy_doc_by_stocktake';
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
  IF to_regprocedure('public.post_named_stock(text, uuid, numeric, text, uuid, text, text, numeric, text, numeric)') IS NULL THEN
    RAISE EXCEPTION 'missing post_named_stock';
  END IF;
  IF to_regprocedure('public.packaging_warehouse_id()') IS NULL
     OR public.packaging_warehouse_id() IS NULL
     OR public.packaging_store_name() NOT LIKE '%تغليف%' THEN
    RAISE EXCEPTION 'packaging warehouse is not the inventory_items store';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_00_reject_premature_dispatched'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'premature dispatched guard is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_00_stale_products_stock'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'stale stock guard is missing';
  END IF;
  IF to_regprocedure('public.inventory_reconciliation_check_core(integer)') IS NULL THEN
    RAISE EXCEPTION 'reconciliation core was not renamed';
  END IF;
  IF to_regprocedure('public.stock_report_totals(uuid)') IS NULL THEN
    RAISE EXCEPTION 'missing stock_report_totals';
  END IF;
  IF to_regprocedure('public.post_manual_inventory_movement(uuid, text, numeric, text, text, text, text, text, timestamptz, text, numeric, numeric, uuid)') IS NULL
     OR to_regprocedure('public.inv_post_movement(uuid, uuid, text, numeric, numeric, text, text, text, text, boolean, uuid)') IS NULL
     OR to_regprocedure('public.inv_transfer(uuid, uuid, numeric, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'manual request key argument is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'courier_return_line_once'
  ) THEN
    RAISE EXCEPTION 'courier return unique key is missing';
  END IF;
END
$post$;

-- Guard trigger on every active store. A missing name fails the apply.
DO $guards$
DECLARE
  v_name text;
  v_missing text := '';
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'trg_00_reject_direct_inventory_stock_write',
    'trg_00_reject_direct_inventory_stock_insert',
    'trg_00_reject_direct_inventory_movement_write',
    'trg_00_reject_direct_meat_raw_stock',
    'trg_00_named_stock_feed_raw',
    'trg_00_named_stock_feed_products',
    'trg_00_named_stock_slaughter_feed',
    'trg_00_named_stock_brooding_feed',
    'trg_00_named_stock_mf_products',
    'trg_00_stale_products_stock',
    'trg_00_stale_meat_raw',
    'trg_00_stale_meat_finished',
    'trg_00_stale_meat_packaging',
    'trg_00_stale_mf_raw_materials',
    'trg_00_stale_mf_finished_items',
    'trg_00_stale_packaging_materials',
    'trg_00_packaging_history_raw',
    'trg_00_packaging_history_main',
    'trg_00_reject_premature_dispatched'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = v_name AND NOT tgisinternal
    ) THEN
      v_missing := v_missing || ' ' || v_name;
    END IF;
  END LOOP;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'guard trigger missing:%', v_missing;
  END IF;
END
$guards$;

SELECT c.relname AS store, t.tgname AS guard
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND NOT t.tgisinternal
   AND t.tgname LIKE 'trg_00_%'
 ORDER BY c.relname, t.tgname;

SELECT check_code, count(*) AS rows
  FROM public.inventory_reconciliation_check(3)
 GROUP BY check_code
 ORDER BY check_code;

SELECT * FROM public.report_duplicate_inventory_cards();

SELECT w.name AS warehouse_name, g.warehouse_id, g.role::text, g.capability
  FROM public.warehouse_role_grants g
  JOIN public.warehouses w ON w.id = g.warehouse_id
 ORDER BY w.name, g.role::text, g.capability;

SELECT 'unmapped_packaging' AS report, count(*) AS rows FROM public.list_unmapped_packaging()
UNION ALL
SELECT 'unmapped_slaughter', count(*) FROM public.list_unmapped_slaughter_outputs()
UNION ALL
SELECT 'untransferred_production', count(*) FROM public.list_untransferred_production()
UNION ALL
SELECT 'open_items', count(*) FROM public.closed_loop_open_items();

-- Same stock-writer check CI runs. Fails the script if a non-ledger function writes stock.
\ir check_ledger_stock_writers.sql
