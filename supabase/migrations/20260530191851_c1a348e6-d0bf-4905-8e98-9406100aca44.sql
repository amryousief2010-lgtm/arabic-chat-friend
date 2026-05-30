
-- Stock take (جرد) for feed factory
CREATE TABLE public.feed_stock_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_no TEXT NOT NULL UNIQUE DEFAULT ('SC-' || to_char(now(),'YYYYMMDD-HH24MISS')),
  count_date DATE NOT NULL DEFAULT CURRENT_DATE,
  warehouse_kind TEXT NOT NULL CHECK (warehouse_kind IN ('raw_material','finished_feed','both')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','closed')),
  total_variance_value NUMERIC NOT NULL DEFAULT 0,
  created_by UUID,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.feed_stock_count_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id UUID NOT NULL REFERENCES public.feed_stock_counts(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('raw_material','finished_feed')),
  raw_material_id UUID REFERENCES public.feed_raw_materials(id),
  feed_product_id UUID REFERENCES public.feed_products(id),
  item_name TEXT NOT NULL,
  unit TEXT,
  system_qty NUMERIC NOT NULL DEFAULT 0,
  counted_qty NUMERIC NOT NULL DEFAULT 0,
  variance NUMERIC GENERATED ALWAYS AS (counted_qty - system_qty) STORED,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  variance_value NUMERIC GENERATED ALWAYS AS ((counted_qty - system_qty) * unit_cost) STORED,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_stock_counts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_stock_count_items TO authenticated;
GRANT ALL ON public.feed_stock_counts TO service_role;
GRANT ALL ON public.feed_stock_count_items TO service_role;

ALTER TABLE public.feed_stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_stock_count_items ENABLE ROW LEVEL SECURITY;

-- Allowed roles: general_manager, executive_manager, financial_manager, feed_factory_manager, warehouse_supervisor (view)
CREATE POLICY "view stock counts" ON public.feed_stock_counts FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'general_manager') OR
  public.has_role(auth.uid(),'executive_manager') OR
  public.has_role(auth.uid(),'financial_manager') OR
  public.has_role(auth.uid(),'feed_factory_manager') OR
  public.has_role(auth.uid(),'warehouse_supervisor')
);
CREATE POLICY "insert stock counts" ON public.feed_stock_counts FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR
  public.has_role(auth.uid(),'executive_manager')
);
CREATE POLICY "update stock counts" ON public.feed_stock_counts FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(),'general_manager') OR
  public.has_role(auth.uid(),'executive_manager')
);
CREATE POLICY "delete stock counts" ON public.feed_stock_counts FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'general_manager'));

CREATE POLICY "view stock count items" ON public.feed_stock_count_items FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'general_manager') OR
  public.has_role(auth.uid(),'executive_manager') OR
  public.has_role(auth.uid(),'financial_manager') OR
  public.has_role(auth.uid(),'feed_factory_manager') OR
  public.has_role(auth.uid(),'warehouse_supervisor')
);
CREATE POLICY "manage stock count items" ON public.feed_stock_count_items FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(),'general_manager') OR
  public.has_role(auth.uid(),'executive_manager')
)
WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR
  public.has_role(auth.uid(),'executive_manager')
);

CREATE INDEX idx_fsc_date ON public.feed_stock_counts(count_date DESC);
CREATE INDEX idx_fsci_count ON public.feed_stock_count_items(count_id);
