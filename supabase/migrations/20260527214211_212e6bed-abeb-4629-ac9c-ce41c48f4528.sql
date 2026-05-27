
-- 1) Update can_approve_warehouse_transfer overload that excludes requester
CREATE OR REPLACE FUNCTION public.can_approve_warehouse_transfer(_uid uuid, _transfer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _uid
      AND ur.role IN ('general_manager','executive_manager','warehouse_supervisor')
  ) AND NOT EXISTS(
    SELECT 1 FROM public.warehouse_transfers t
    WHERE t.id = _transfer_id AND t.created_by = _uid
  );
$$;

-- 2) inventory_items
DROP POLICY IF EXISTS "Warehouse managers manage inventory items" ON public.inventory_items;
CREATE POLICY "Warehouse managers manage inventory items"
ON public.inventory_items
FOR ALL
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role])
  OR (
    public.has_role(auth.uid(), 'agouza_warehouse_keeper'::app_role)
    AND warehouse_id IN (SELECT id FROM public.warehouses WHERE name ILIKE '%العجوزة%')
  )
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role])
  OR (
    public.has_role(auth.uid(), 'agouza_warehouse_keeper'::app_role)
    AND warehouse_id IN (SELECT id FROM public.warehouses WHERE name ILIKE '%العجوزة%')
  )
);

-- 3) slaughter_batches
DROP POLICY IF EXISTS "manage slaughter batches" ON public.slaughter_batches;
CREATE POLICY "manage slaughter batches"
ON public.slaughter_batches
FOR ALL
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'slaughterhouse_manager'::app_role, 'production_manager'::app_role, 'agouza_warehouse_keeper'::app_role]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'slaughterhouse_manager'::app_role, 'production_manager'::app_role, 'agouza_warehouse_keeper'::app_role]));

-- 4) warehouse_transfers policies
DROP POLICY IF EXISTS "wt_select_authorized" ON public.warehouse_transfers;
CREATE POLICY "wt_select_authorized"
ON public.warehouse_transfers
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role, 'agouza_warehouse_keeper'::app_role]));

CREATE POLICY "wt_insert_authorized"
ON public.warehouse_transfers
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role, 'agouza_warehouse_keeper'::app_role])
  AND created_by = auth.uid()
);

CREATE POLICY "wt_update_authorized"
ON public.warehouse_transfers
FOR UPDATE
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role]));

-- 5) warehouse_transfer_items
DROP POLICY IF EXISTS "wti_select_authorized" ON public.warehouse_transfer_items;
CREATE POLICY "wti_select_authorized"
ON public.warehouse_transfer_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.warehouse_transfers t
    WHERE t.id = warehouse_transfer_items.transfer_id
      AND public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role, 'agouza_warehouse_keeper'::app_role])
  )
);

CREATE POLICY "wti_insert_authorized"
ON public.warehouse_transfer_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.warehouse_transfers t
    WHERE t.id = warehouse_transfer_items.transfer_id
      AND public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role, 'agouza_warehouse_keeper'::app_role])
  )
);

CREATE POLICY "wti_update_authorized"
ON public.warehouse_transfer_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.warehouse_transfers t
    WHERE t.id = warehouse_transfer_items.transfer_id
      AND public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role])
  )
);

-- 6) delivery_collection_batches
CREATE TABLE public.delivery_collection_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rep_name TEXT NOT NULL,
  rep_user_id UUID,
  collector_id UUID NOT NULL,
  expected_total NUMERIC NOT NULL DEFAULT 0,
  actual_total NUMERIC NOT NULL DEFAULT 0,
  variance_amount NUMERIC GENERATED ALWAYS AS (expected_total - actual_total) STORED,
  variance_reason TEXT,
  notes TEXT,
  collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_collection_batches TO authenticated;
GRANT ALL ON public.delivery_collection_batches TO service_role;
ALTER TABLE public.delivery_collection_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dcb_select" ON public.delivery_collection_batches
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role, 'financial_manager'::app_role, 'accountant'::app_role]));

CREATE POLICY "dcb_insert" ON public.delivery_collection_batches
FOR INSERT TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role])
  AND collector_id = auth.uid()
);

-- 7) delivery_collection_batch_orders
CREATE TABLE public.delivery_collection_batch_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES public.delivery_collection_batches(id) ON DELETE CASCADE,
  order_id UUID NOT NULL,
  order_total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_collection_batch_orders TO authenticated;
GRANT ALL ON public.delivery_collection_batch_orders TO service_role;
ALTER TABLE public.delivery_collection_batch_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dcbo_select" ON public.delivery_collection_batch_orders
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role, 'financial_manager'::app_role, 'accountant'::app_role]));

CREATE POLICY "dcbo_insert" ON public.delivery_collection_batch_orders
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.delivery_collection_batches b
    WHERE b.id = batch_id AND b.collector_id = auth.uid()
  )
);

CREATE INDEX idx_dcbo_batch ON public.delivery_collection_batch_orders(batch_id);
CREATE INDEX idx_dcbo_order ON public.delivery_collection_batch_orders(order_id);

-- 8) Add collection columns to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS collected_by UUID,
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS collection_batch_id UUID REFERENCES public.delivery_collection_batches(id);

CREATE INDEX IF NOT EXISTS idx_orders_collection_batch ON public.orders(collection_batch_id);
