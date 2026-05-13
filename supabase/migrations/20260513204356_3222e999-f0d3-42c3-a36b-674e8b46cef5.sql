
-- Add price/supplier ref columns to replenishment log
ALTER TABLE public.stock_replenishment_log
  ADD COLUMN IF NOT EXISTS unit_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_reference text;

-- Per-product manufacturing status table
CREATE TABLE IF NOT EXISTS public.manufacturing_status (
  product_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending', -- pending | in_progress | completed
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.manufacturing_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS view_manufacturing_status ON public.manufacturing_status;
CREATE POLICY view_manufacturing_status ON public.manufacturing_status
  FOR SELECT USING (
    has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'warehouse_supervisor'::app_role,'accountant'::app_role,'production_manager'::app_role,'quality_manager'::app_role])
  );

DROP POLICY IF EXISTS upsert_manufacturing_status ON public.manufacturing_status;
CREATE POLICY upsert_manufacturing_status ON public.manufacturing_status
  FOR INSERT WITH CHECK (
    has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role,'production_manager'::app_role,'quality_manager'::app_role])
  );

DROP POLICY IF EXISTS update_manufacturing_status ON public.manufacturing_status;
CREATE POLICY update_manufacturing_status ON public.manufacturing_status
  FOR UPDATE USING (
    has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role,'production_manager'::app_role,'quality_manager'::app_role])
  );
