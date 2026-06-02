DROP POLICY IF EXISTS "auth read treasury" ON public.feed_factory_treasury_txns;

CREATE POLICY "treasury_read_authorized" ON public.feed_factory_treasury_txns
  FOR SELECT
  USING (
    public.has_any_role(auth.uid(), ARRAY[
      'general_manager',
      'executive_manager',
      'financial_manager',
      'accountant',
      'cost_accountant',
      'feed_factory_manager',
      'warehouse_supervisor'
    ]::app_role[])
  );