
DO $$
DECLARE
  ids uuid[];
BEGIN
  SELECT array_agg(id) INTO ids FROM brooding_batches WHERE batch_number IN ('BRD-003','BRD-004');
  IF ids IS NOT NULL THEN
    DELETE FROM brooding_mortality WHERE batch_id = ANY(ids);
    DELETE FROM brooding_feed_issuance WHERE batch_id = ANY(ids);
    DELETE FROM brooding_medicine_issuance WHERE batch_id = ANY(ids);
    DELETE FROM brooding_expenses WHERE batch_id = ANY(ids);
    DELETE FROM brooding_chick_sales WHERE batch_id = ANY(ids);
    DELETE FROM brooding_to_slaughter_transfers WHERE batch_id = ANY(ids);
    DELETE FROM brooding_batch_movements WHERE batch_id = ANY(ids);
    DELETE FROM brooding_batches WHERE id = ANY(ids);
  END IF;
END $$;
