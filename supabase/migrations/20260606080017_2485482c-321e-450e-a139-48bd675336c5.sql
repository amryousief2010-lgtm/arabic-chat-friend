
DROP POLICY IF EXISTS "create staging runs" ON public.import_staging_runs;
DROP POLICY IF EXISTS "view staging runs" ON public.import_staging_runs;
DROP POLICY IF EXISTS "update staging runs" ON public.import_staging_runs;
DROP POLICY IF EXISTS "manage staging rows" ON public.import_staging_rows;
DROP POLICY IF EXISTS "view staging rows" ON public.import_staging_rows;

CREATE POLICY "create staging runs" ON public.import_staging_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND has_any_role(auth.uid(), ARRAY[
      'general_manager'::app_role, 'executive_manager'::app_role,
      'warehouse_supervisor'::app_role, 'meat_factory_manager'::app_role,
      'feed_factory_manager'::app_role, 'hatchery_manager'::app_role,
      'farm_manager'::app_role, 'production_manager'::app_role
    ])
  );

CREATE POLICY "update staging runs" ON public.import_staging_runs
  FOR UPDATE TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY[
      'general_manager'::app_role, 'executive_manager'::app_role,
      'warehouse_supervisor'::app_role, 'meat_factory_manager'::app_role,
      'feed_factory_manager'::app_role, 'hatchery_manager'::app_role,
      'farm_manager'::app_role, 'production_manager'::app_role
    ])
  );

CREATE POLICY "view staging runs" ON public.import_staging_runs
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY[
      'general_manager'::app_role, 'executive_manager'::app_role,
      'warehouse_supervisor'::app_role, 'meat_factory_manager'::app_role,
      'feed_factory_manager'::app_role, 'accountant'::app_role,
      'financial_manager'::app_role, 'production_manager'::app_role,
      'hatchery_manager'::app_role, 'farm_manager'::app_role
    ])
  );

CREATE POLICY "manage staging rows" ON public.import_staging_rows
  FOR ALL TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY[
      'general_manager'::app_role, 'executive_manager'::app_role,
      'warehouse_supervisor'::app_role, 'meat_factory_manager'::app_role,
      'feed_factory_manager'::app_role, 'hatchery_manager'::app_role,
      'farm_manager'::app_role, 'production_manager'::app_role
    ])
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY[
      'general_manager'::app_role, 'executive_manager'::app_role,
      'warehouse_supervisor'::app_role, 'meat_factory_manager'::app_role,
      'feed_factory_manager'::app_role, 'hatchery_manager'::app_role,
      'farm_manager'::app_role, 'production_manager'::app_role
    ])
  );

CREATE POLICY "view staging rows" ON public.import_staging_rows
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.import_staging_runs r
      WHERE r.id = import_staging_rows.run_id
        AND has_any_role(auth.uid(), ARRAY[
          'general_manager'::app_role, 'executive_manager'::app_role,
          'warehouse_supervisor'::app_role, 'meat_factory_manager'::app_role,
          'feed_factory_manager'::app_role, 'accountant'::app_role,
          'financial_manager'::app_role, 'production_manager'::app_role,
          'hatchery_manager'::app_role, 'farm_manager'::app_role
        ])
    )
  );
