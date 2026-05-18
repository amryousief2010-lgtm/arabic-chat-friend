
CREATE TABLE IF NOT EXISTS public.production_dispatch_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid,
  product_name text NOT NULL,
  unit text NOT NULL DEFAULT 'كجم',
  required_qty numeric NOT NULL CHECK (required_qty > 0),
  current_stock numeric NOT NULL DEFAULT 0,
  pending_qty numeric NOT NULL DEFAULT 0,
  destination text NOT NULL CHECK (destination IN ('slaughterhouse','meat_factory')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','in_progress','completed','cancelled')),
  affected_orders jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdo_dest_status ON public.production_dispatch_orders(destination, status);
CREATE INDEX IF NOT EXISTS idx_pdo_product ON public.production_dispatch_orders(product_id);
CREATE INDEX IF NOT EXISTS idx_pdo_created ON public.production_dispatch_orders(created_at DESC);

DROP TRIGGER IF EXISTS pdo_set_updated_at ON public.production_dispatch_orders;
CREATE TRIGGER pdo_set_updated_at
BEFORE UPDATE ON public.production_dispatch_orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.production_dispatch_orders ENABLE ROW LEVEL SECURITY;

-- Creators / managers / warehouse view all
DROP POLICY IF EXISTS "pdo_select_managers" ON public.production_dispatch_orders;
CREATE POLICY "pdo_select_managers" ON public.production_dispatch_orders
FOR SELECT TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'sales_manager'::app_role,'production_manager'::app_role,
    'warehouse_supervisor'::app_role,'marketing_sales_manager'::app_role,
    'financial_manager'::app_role
  ])
);

DROP POLICY IF EXISTS "pdo_select_slaughterhouse" ON public.production_dispatch_orders;
CREATE POLICY "pdo_select_slaughterhouse" ON public.production_dispatch_orders
FOR SELECT TO authenticated USING (
  destination = 'slaughterhouse'
  AND public.has_role(auth.uid(), 'slaughterhouse_manager'::app_role)
);

DROP POLICY IF EXISTS "pdo_select_meat_factory" ON public.production_dispatch_orders;
CREATE POLICY "pdo_select_meat_factory" ON public.production_dispatch_orders
FOR SELECT TO authenticated USING (
  destination = 'meat_factory'
  AND public.has_role(auth.uid(), 'meat_factory_manager'::app_role)
);

-- Insert: creators
DROP POLICY IF EXISTS "pdo_insert_creators" ON public.production_dispatch_orders;
CREATE POLICY "pdo_insert_creators" ON public.production_dispatch_orders
FOR INSERT TO authenticated WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'sales_manager'::app_role,'production_manager'::app_role,
    'warehouse_supervisor'::app_role
  ])
);

-- Update: managers + destination owner
DROP POLICY IF EXISTS "pdo_update_managers" ON public.production_dispatch_orders;
CREATE POLICY "pdo_update_managers" ON public.production_dispatch_orders
FOR UPDATE TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'production_manager'::app_role,'warehouse_supervisor'::app_role
  ])
);

DROP POLICY IF EXISTS "pdo_update_slaughterhouse" ON public.production_dispatch_orders;
CREATE POLICY "pdo_update_slaughterhouse" ON public.production_dispatch_orders
FOR UPDATE TO authenticated USING (
  destination = 'slaughterhouse'
  AND public.has_role(auth.uid(), 'slaughterhouse_manager'::app_role)
);

DROP POLICY IF EXISTS "pdo_update_meat_factory" ON public.production_dispatch_orders;
CREATE POLICY "pdo_update_meat_factory" ON public.production_dispatch_orders
FOR UPDATE TO authenticated USING (
  destination = 'meat_factory'
  AND public.has_role(auth.uid(), 'meat_factory_manager'::app_role)
);

-- Delete: only top managers
DROP POLICY IF EXISTS "pdo_delete_managers" ON public.production_dispatch_orders;
CREATE POLICY "pdo_delete_managers" ON public.production_dispatch_orders
FOR DELETE TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role
  ])
);
