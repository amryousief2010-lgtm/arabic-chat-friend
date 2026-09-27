-- Fail if any function other than the ledger assigns inventory_items.stock,
-- or if a non-posting function both inserts a movement and assigns stock.
-- Also fail if cost columns are visible to anon/authenticated.
-- A later GRANT SELECT ON TABLE re-grants every column; this check catches it.

DO $check$
DECLARE
  r record;
  n int := 0;
  names text := '';
BEGIN
  FOR r IN
    SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
     WHERE nsp.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proname <> ALL (ARRAY[
         'post_inventory_movement',
         'apply_inventory_movement',
         'adjust_inventory_movement_on_update',
         'reverse_inventory_movement_on_delete',
         'redirect_merged_item_stock',
         'ledger_apply_card_stock',
         'reject_direct_inventory_stock_write'
       ])
       AND (
         p.prosrc ~ 'UPDATE[[:space:]]+(public\.)?inventory_items[[:space:]]+SET[[:space:]]+stock[[:space:]]*='
         OR p.prosrc ~ 'NEW\.stock[[:space:]]*:='
       )
  LOOP
    n := n + 1;
    names := names || ' ' || r.proname;
  END LOOP;
  IF n > 0 THEN
    RAISE EXCEPTION 'non-ledger functions write inventory_items.stock:%', names;
  END IF;

  n := 0;
  names := '';
  FOR r IN
    SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
     WHERE nsp.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proname <> ALL (ARRAY['post_meat_raw_movement', 'reject_direct_meat_raw_stock_write'])
       AND p.prosrc ~ 'UPDATE[[:space:]]+(public\.)?meat_factory_raw_items[[:space:]]+SET[[:space:]]+current_stock[[:space:]]*='
  LOOP
    n := n + 1;
    names := names || ' ' || r.proname;
  END LOOP;
  IF n > 0 THEN
    RAISE EXCEPTION 'non-poster functions write meat_factory_raw_items.current_stock:%', names;
  END IF;

  n := 0;
  names := '';
  FOR r IN
    SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
     WHERE nsp.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proname <> 'post_inventory_movement'
       AND p.prosrc ~* 'INSERT[[:space:]]+INTO[[:space:]]+(public\.)?inventory_movements'
       AND (
         p.prosrc ~ 'UPDATE[[:space:]]+(public\.)?inventory_items[[:space:]]+SET[[:space:]]+stock[[:space:]]*='
         OR p.prosrc ~ 'NEW\.stock[[:space:]]*:='
       )
  LOOP
    n := n + 1;
    names := names || ' ' || r.proname;
  END LOOP;
  IF n > 0 THEN
    RAISE EXCEPTION 'insert-and-assign double count:%', names;
  END IF;

  IF has_column_privilege('authenticated', 'public.inventory_movements', 'unit_cost', 'SELECT')
     OR has_column_privilege('authenticated', 'public.inventory_movements', 'total_cost', 'SELECT')
     OR has_column_privilege('anon', 'public.inventory_movements', 'unit_cost', 'SELECT')
     OR has_column_privilege('authenticated', 'public.inventory_items', 'unit_cost', 'SELECT')
     OR has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT')
     OR has_column_privilege('anon', 'public.products', 'cost_price', 'SELECT')
  THEN
    RAISE EXCEPTION 'cost column is visible to anon or authenticated';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.products', 'price', 'SELECT') THEN
    RAISE EXCEPTION 'sale price is hidden from authenticated';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.post_inventory_movement(uuid, text, numeric, text, uuid, text, text, text, timestamptz, numeric, text, text, text, boolean, uuid, uuid, text, uuid, text, text, text, uuid, numeric, numeric, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post_inventory_movement is not executable';
  END IF;
END
$check$;
