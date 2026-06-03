
-- assign role
INSERT INTO public.user_roles (user_id, role) VALUES
  ('f8606d36-c0df-475c-9f7e-bd45ed95137e', 'brooding_dashboard_viewer'),
  ('d1d37093-182a-4ee9-932c-d2a2b45f33ec', 'brooding_dashboard_viewer')
ON CONFLICT (user_id, role) DO NOTHING;

-- read-only SELECT policies on all brooding tables for the viewer role
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'brooding_batches','brooding_batch_movements','brooding_chick_sales',
    'brooding_cost_snapshots','brooding_expenses','brooding_feed_issuance',
    'brooding_medicine_issuance','brooding_mortality','brooding_to_slaughter_transfers'
  ]) LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "brooding_viewer_read" ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY "brooding_viewer_read" ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''brooding_dashboard_viewer''::app_role));', t);
  END LOOP;
END $$;
