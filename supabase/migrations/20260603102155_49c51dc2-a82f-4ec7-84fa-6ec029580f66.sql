-- 1) Cleanup test data first (BRD-003, BRD-004, BRD-005)
DELETE FROM public.brooding_batch_movements WHERE batch_id IN (SELECT id FROM public.brooding_batches WHERE batch_number IN ('BRD-003','BRD-004','BRD-005'));
DELETE FROM public.brooding_mortality           WHERE batch_id IN (SELECT id FROM public.brooding_batches WHERE batch_number IN ('BRD-003','BRD-004','BRD-005'));
DELETE FROM public.brooding_feed_issuance       WHERE batch_id IN (SELECT id FROM public.brooding_batches WHERE batch_number IN ('BRD-003','BRD-004','BRD-005'));
DELETE FROM public.brooding_medicine_issuance   WHERE batch_id IN (SELECT id FROM public.brooding_batches WHERE batch_number IN ('BRD-003','BRD-004','BRD-005'));
DELETE FROM public.brooding_expenses            WHERE batch_id IN (SELECT id FROM public.brooding_batches WHERE batch_number IN ('BRD-003','BRD-004','BRD-005'));
DELETE FROM public.brooding_chick_sales         WHERE batch_id IN (SELECT id FROM public.brooding_batches WHERE batch_number IN ('BRD-003','BRD-004','BRD-005'));
DELETE FROM public.brooding_to_slaughter_transfers WHERE batch_id IN (SELECT id FROM public.brooding_batches WHERE batch_number IN ('BRD-003','BRD-004','BRD-005'));
DELETE FROM public.brooding_batches             WHERE batch_number IN ('BRD-003','BRD-004','BRD-005');

-- 2) Tighten constraint: original_count must be strictly positive
ALTER TABLE public.brooding_batches DROP CONSTRAINT IF EXISTS brooding_batches_original_count_check;
ALTER TABLE public.brooding_batches ADD CONSTRAINT brooding_batches_original_count_check CHECK (original_count > 0);