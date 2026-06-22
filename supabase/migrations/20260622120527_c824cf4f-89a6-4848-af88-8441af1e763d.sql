
-- Reverse the unwanted manufacturing_labor backfill.
-- Keep only the two requested invoices: PROD-260622104039203 and PROD-260622104449818.
-- Delete all other TRZ-LAB-BF-* backfill rows created by the prior backfill run.

DO $$
DECLARE
  v_deleted_count int;
  v_deleted_total numeric;
  v_kept_total numeric;
BEGIN
  -- Snapshot to audit log via NOTICE
  SELECT COUNT(*), COALESCE(SUM(amount),0)
    INTO v_deleted_count, v_deleted_total
  FROM public.feed_factory_treasury_txns
  WHERE kind = 'manufacturing_labor'
    AND txn_no LIKE 'TRZ-LAB-BF-%'
    AND ref_id NOT IN (
      SELECT id FROM public.feed_production_invoices
      WHERE prod_no IN ('PROD-260622104039203','PROD-260622104449818')
    );

  DELETE FROM public.feed_factory_treasury_txns
  WHERE kind = 'manufacturing_labor'
    AND txn_no LIKE 'TRZ-LAB-BF-%'
    AND ref_id NOT IN (
      SELECT id FROM public.feed_production_invoices
      WHERE prod_no IN ('PROD-260622104039203','PROD-260622104449818')
    );

  SELECT COALESCE(SUM(amount),0) INTO v_kept_total
    FROM public.feed_factory_treasury_txns
    WHERE kind='manufacturing_labor';

  RAISE NOTICE 'Reversed backfill rows: % (total %); kept manufacturing_labor total: %',
    v_deleted_count, v_deleted_total, v_kept_total;
END $$;
