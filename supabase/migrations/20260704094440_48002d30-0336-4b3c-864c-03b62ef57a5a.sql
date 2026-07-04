
DO $$
DECLARE
  main_wh uuid := '5ec781b5-685b-4806-b59a-83a79ea5662c';
  tbl text;
  tables text[] := ARRAY[
    'courier_goods_custodies',
    'courier_order_assignments',
    'pc_order_tracking',
    'pc_collections',
    'pc_failed_attempts',
    'courier_daily_cash_deposits',
    'courier_daily_cash_deposit_lines',
    'courier_daily_closures',
    'delivery_collection_batches',
    'courier_commission_payouts',
    'courier_profiles'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- add column if missing
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS warehouse_id uuid',
      tbl
    );
    -- backfill NULLs to main
    EXECUTE format(
      'UPDATE public.%I SET warehouse_id = %L WHERE warehouse_id IS NULL',
      tbl, main_wh
    );
    -- default for future rows
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN warehouse_id SET DEFAULT %L',
      tbl, main_wh
    );
    -- index
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (warehouse_id)',
      'idx_' || tbl || '_warehouse_id', tbl
    );
  END LOOP;
END $$;
