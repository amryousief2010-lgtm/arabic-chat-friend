
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brooding_batches','brooding_batch_movements','brooding_chick_sales',
    'brooding_cost_snapshots','brooding_expenses','brooding_feed_issuance',
    'brooding_medicine_issuance','brooding_mortality','brooding_to_slaughter_transfers'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS brooding_managers_full ON public.%I', t);
    EXECUTE format($f$CREATE POLICY brooding_managers_full ON public.%I FOR ALL TO authenticated
      USING (has_role(auth.uid(),'brooding_manager') OR has_role(auth.uid(),'production_manager'))
      WITH CHECK (has_role(auth.uid(),'brooding_manager') OR has_role(auth.uid(),'production_manager'))$f$, t);
  END LOOP;
END$$;
