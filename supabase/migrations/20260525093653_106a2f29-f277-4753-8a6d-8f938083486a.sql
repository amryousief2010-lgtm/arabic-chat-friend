
-- =====================================================
-- IMPORT PIPELINE: runs, staging, RPCs
-- =====================================================

-- 1) import_runs
CREATE TABLE IF NOT EXISTS public.import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet text NOT NULL,
  filename text,
  uploaded_by uuid REFERENCES auth.users(id),
  total_rows int DEFAULT 0,
  valid_rows int DEFAULT 0,
  error_rows int DEFAULT 0,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','validated','approved','posted','failed')),
  posted_at timestamptz,
  posted_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_runs_select_mgmt_or_owner" ON public.import_runs FOR SELECT
USING (
  uploaded_by = auth.uid()
  OR public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','accountant','financial_manager',
    'warehouse_supervisor','meat_factory_manager','feed_factory_manager'
  ]::app_role[])
);
CREATE POLICY "import_runs_insert_priv" ON public.import_runs FOR INSERT
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','accountant','financial_manager',
    'warehouse_supervisor','meat_factory_manager','feed_factory_manager'
  ]::app_role[])
);
CREATE POLICY "import_runs_update_mgmt" ON public.import_runs FOR UPDATE
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','accountant','financial_manager'
  ]::app_role[])
);

-- 2) import_catalog_staging
CREATE TABLE IF NOT EXISTS public.import_catalog_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.import_runs(id) ON DELETE CASCADE,
  source_sheet text NOT NULL,
  module text NOT NULL CHECK (module IN ('shared','meat','feed','packaging')),
  item_code text,
  name_ar text,
  category text,
  unit text,
  barcode text,
  default_price numeric,
  default_cost numeric,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','posted')),
  error_reason text,
  raw_row jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_stg_run ON public.import_catalog_staging(run_id, status);
ALTER TABLE public.import_catalog_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catalog_stg_select" ON public.import_catalog_staging FOR SELECT
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','accountant','financial_manager',
    'warehouse_supervisor','meat_factory_manager','feed_factory_manager'
  ]::app_role[])
);
CREATE POLICY "catalog_stg_insert" ON public.import_catalog_staging FOR INSERT
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','accountant',
    'warehouse_supervisor','meat_factory_manager','feed_factory_manager'
  ]::app_role[])
);
CREATE POLICY "catalog_stg_update" ON public.import_catalog_staging FOR UPDATE
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','accountant','financial_manager'
  ]::app_role[])
);

-- 3) inventory_stock_snapshots (staging)
CREATE TABLE IF NOT EXISTS public.inventory_stock_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.import_runs(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  warehouse_code text,
  warehouse_id uuid,
  item_code text,
  item_name_ar text,
  qty numeric NOT NULL DEFAULT 0,
  unit text,
  source_sheet text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','posted')),
  posted_movement_id uuid,
  error_reason text,
  raw_row jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_snap_run ON public.inventory_stock_snapshots(run_id, status);
ALTER TABLE public.inventory_stock_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_snap_select" ON public.inventory_stock_snapshots FOR SELECT
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','accountant','financial_manager','warehouse_supervisor'
  ]::app_role[])
);
CREATE POLICY "stock_snap_insert" ON public.inventory_stock_snapshots FOR INSERT
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','warehouse_supervisor'
  ]::app_role[])
);
CREATE POLICY "stock_snap_update" ON public.inventory_stock_snapshots FOR UPDATE
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','warehouse_supervisor'
  ]::app_role[])
);

-- 4) Extend existing tables with import_run_id + version (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='meat_factory_invoices') THEN
    BEGIN ALTER TABLE public.meat_factory_invoices ADD COLUMN IF NOT EXISTS import_run_id uuid; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='feed_invoice_batches') THEN
    BEGIN ALTER TABLE public.feed_invoice_batches ADD COLUMN IF NOT EXISTS import_run_id uuid; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='meat_factory_recipes') THEN
    BEGIN ALTER TABLE public.meat_factory_recipes ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE public.meat_factory_recipes ADD COLUMN IF NOT EXISTS approved_by uuid; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE public.meat_factory_recipes ADD COLUMN IF NOT EXISTS approved_at timestamptz; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE public.meat_factory_recipes ADD COLUMN IF NOT EXISTS import_run_id uuid; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='feed_recipes') THEN
    BEGIN ALTER TABLE public.feed_recipes ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE public.feed_recipes ADD COLUMN IF NOT EXISTS approved_by uuid; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE public.feed_recipes ADD COLUMN IF NOT EXISTS approved_at timestamptz; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE public.feed_recipes ADD COLUMN IF NOT EXISTS import_run_id uuid; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='data_quality_tasks') THEN
    BEGIN CREATE INDEX IF NOT EXISTS idx_dq_module_status ON public.data_quality_tasks(module, status, severity); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END$$;

-- 5) Validation RPC
CREATE OR REPLACE FUNCTION public.import_validate_catalog(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_total int; v_valid int; v_errs int;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','accountant','financial_manager',
    'warehouse_supervisor','meat_factory_manager','feed_factory_manager'
  ]::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE public.import_catalog_staging SET status='pending', error_reason=NULL
   WHERE run_id=p_run_id AND status NOT IN ('posted');

  UPDATE public.import_catalog_staging
     SET status='rejected', error_reason='item_code فارغ'
   WHERE run_id=p_run_id AND COALESCE(item_code,'')='';

  UPDATE public.import_catalog_staging
     SET status='rejected', error_reason='الوحدة (unit) فارغة'
   WHERE run_id=p_run_id AND status='pending' AND COALESCE(unit,'')='';

  -- duplicate item_code within same run
  WITH d AS (
    SELECT item_code FROM public.import_catalog_staging
     WHERE run_id=p_run_id AND status='pending' AND item_code IS NOT NULL
     GROUP BY item_code HAVING COUNT(*) > 1
  )
  UPDATE public.import_catalog_staging s SET status='rejected', error_reason='كود مكرر داخل نفس الرفعة'
   FROM d WHERE s.run_id=p_run_id AND s.item_code=d.item_code AND s.status='pending';

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='pending'), COUNT(*) FILTER (WHERE status='rejected')
    INTO v_total, v_valid, v_errs
    FROM public.import_catalog_staging WHERE run_id=p_run_id;

  UPDATE public.import_runs
     SET total_rows=v_total, valid_rows=v_valid, error_rows=v_errs, status='validated'
   WHERE id=p_run_id;

  RETURN jsonb_build_object('total', v_total, 'valid', v_valid, 'errors', v_errs);
END $$;

-- 6) Post catalog RPC
CREATE OR REPLACE FUNCTION public.import_post_catalog(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r RECORD; v_posted int := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','accountant'
  ]::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك بترحيل الكتالوج';
  END IF;

  FOR r IN
    SELECT * FROM public.import_catalog_staging
     WHERE run_id=p_run_id AND status='pending'
  LOOP
    BEGIN
      IF r.module = 'meat' THEN
        INSERT INTO public.meat_factory_raw_materials (material_code, material_name_ar, unit, stock, unit_cost)
        VALUES (r.item_code, COALESCE(r.name_ar, r.item_code), COALESCE(r.unit,'كجم'), 0, COALESCE(r.default_cost,0))
        ON CONFLICT (material_code) DO UPDATE
          SET material_name_ar = EXCLUDED.material_name_ar,
              unit = EXCLUDED.unit,
              unit_cost = COALESCE(EXCLUDED.unit_cost, public.meat_factory_raw_materials.unit_cost);
      ELSIF r.module = 'feed' THEN
        INSERT INTO public.feed_raw_materials (material_code, material_name_ar, unit, stock, unit_cost)
        VALUES (r.item_code, COALESCE(r.name_ar, r.item_code), COALESCE(r.unit,'كجم'), 0, COALESCE(r.default_cost,0))
        ON CONFLICT (material_code) DO UPDATE
          SET material_name_ar = EXCLUDED.material_name_ar,
              unit = EXCLUDED.unit,
              unit_cost = COALESCE(EXCLUDED.unit_cost, public.feed_raw_materials.unit_cost);
      ELSE
        -- shared & packaging both go to products catalog
        INSERT INTO public.products (name, category, price, barcode, stock, low_stock_threshold, is_active)
        VALUES (
          COALESCE(r.name_ar, r.item_code),
          COALESCE(r.category, CASE WHEN r.module='packaging' THEN 'تغليف' ELSE 'عام' END),
          COALESCE(r.default_price, 0), r.barcode, 0, 5, true
        )
        ON CONFLICT DO NOTHING;
      END IF;

      UPDATE public.import_catalog_staging SET status='posted' WHERE id=r.id;
      v_posted := v_posted + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.import_catalog_staging SET status='rejected', error_reason=SQLERRM WHERE id=r.id;
    END;
  END LOOP;

  UPDATE public.import_runs SET status='posted', posted_at=now(), posted_by=auth.uid() WHERE id=p_run_id;
  RETURN jsonb_build_object('posted', v_posted);
END $$;

-- 7) Post stock snapshot RPC
CREATE OR REPLACE FUNCTION public.import_post_stock_snapshot(p_run_id uuid, p_warehouse_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r RECORD; v_item uuid; v_count int := 0; v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager','executive_manager','warehouse_supervisor'
  ]::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;

  FOR r IN
    SELECT * FROM public.inventory_stock_snapshots
     WHERE run_id=p_run_id AND status='pending' AND qty >= 0
  LOOP
    BEGIN
      SELECT id INTO v_item FROM public.inventory_items
       WHERE warehouse_id = p_warehouse_id AND name = COALESCE(r.item_name_ar, r.item_code)
       LIMIT 1;

      IF v_item IS NULL THEN
        INSERT INTO public.inventory_items (warehouse_id, name, category, unit, stock, unit_cost, low_stock_threshold)
        VALUES (p_warehouse_id, COALESCE(r.item_name_ar, r.item_code), 'عام', COALESCE(r.unit,'قطعة'), 0, 0, 5)
        RETURNING id INTO v_item;
      END IF;

      INSERT INTO public.inventory_movements (item_id, warehouse_id, movement_type, quantity, reference, party, performed_by, notes)
      VALUES (v_item, p_warehouse_id, 'adjustment', r.qty,
              'استيراد رصيد Excel ('||COALESCE(r.source_sheet,'')||')',
              'Excel Import', v_uid,
              'تسوية رصيد افتتاحي من ملف Excel - run '||p_run_id::text);

      UPDATE public.inventory_stock_snapshots
         SET status='posted', warehouse_id=p_warehouse_id
       WHERE id=r.id;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.inventory_stock_snapshots SET status='rejected', error_reason=SQLERRM WHERE id=r.id;
    END;
  END LOOP;

  -- flag negatives as quality tasks
  INSERT INTO public.data_quality_tasks (module, task_type, severity, reference, description, status)
  SELECT 'inventory','negative_stock','high', COALESCE(item_code,'-'),
         'رصيد سالب في snapshot: '||COALESCE(item_name_ar,item_code,'-')||' = '||qty,
         'open'
    FROM public.inventory_stock_snapshots
   WHERE run_id=p_run_id AND qty < 0;

  UPDATE public.import_runs SET status='posted', posted_at=now(), posted_by=v_uid WHERE id=p_run_id;
  RETURN jsonb_build_object('posted', v_count);
END $$;
