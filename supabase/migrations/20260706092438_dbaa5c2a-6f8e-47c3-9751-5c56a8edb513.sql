
-- 2) Assign roles to Mohamed Shaala
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d1d37093-182a-4ee9-932c-d2a2b45f33ec', 'feed_factory_manager'),
  ('d1d37093-182a-4ee9-932c-d2a2b45f33ec', 'marketing_sales_viewer'),
  ('d1d37093-182a-4ee9-932c-d2a2b45f33ec', 'lab_treasury_viewer')
ON CONFLICT (user_id, role) DO NOTHING;

-- 3) Read-only SELECT policies for lab_treasury_viewer on all lab treasury tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'lab_treasury_movements',
    'lab_treasury_advances',
    'lab_treasury_advance_settlements',
    'lab_treasury_day_closures',
    'lab_treasury_opening_balances',
    'lab_treasury_external_collections',
    'lab_treasury_external_deposits',
    'lab_treasury_external_receivables',
    'lab_treasury_external_receivable_settlements',
    'lab_treasury_historical_receivables',
    'lab_treasury_historical_receivable_items',
    'lab_treasury_historical_receivable_settlements',
    'lab_treasury_to_custody_transfers',
    'lab_treasury_audit_log',
    'lab_customer_ledger',
    'lab_customer_ledger_audit'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "lab_treasury_viewer read" ON public.%I;', t
    );
    EXECUTE format(
      'CREATE POLICY "lab_treasury_viewer read" ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''lab_treasury_viewer''::public.app_role));',
      t
    );
  END LOOP;
END $$;

-- 4) Read-only SELECT policies for marketing_sales_viewer on marketing/social-media/sales data
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'social_media_daily_reports',
    'social_media_weekly_reports',
    'social_media_weekly_top_posts',
    'social_media_expenses',
    'orders',
    'order_items',
    'customers',
    'offer_boxes',
    'offer_box_items',
    'sales_targets',
    'target_bonus_settings',
    'payroll_bonus_overrides',
    'delivery_routes',
    'courier_order_assignments',
    'products',
    'menu_price_changes'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "marketing_sales_viewer read" ON public.%I;', t
    );
    EXECUTE format(
      'CREATE POLICY "marketing_sales_viewer read" ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''marketing_sales_viewer''::public.app_role));',
      t
    );
  END LOOP;
END $$;
