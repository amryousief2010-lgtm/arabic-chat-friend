
-- 1) Extend pc_courier_status enum with the 6 missing stages
ALTER TYPE public.pc_courier_status ADD VALUE IF NOT EXISTS 'approved_by_marketing';
ALTER TYPE public.pc_courier_status ADD VALUE IF NOT EXISTS 'prepared_by_warehouse';
ALTER TYPE public.pc_courier_status ADD VALUE IF NOT EXISTS 'collected';
ALTER TYPE public.pc_courier_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE public.pc_courier_status ADD VALUE IF NOT EXISTS 'partially_returned';
ALTER TYPE public.pc_courier_status ADD VALUE IF NOT EXISTS 'fully_returned';

-- 2) Link bonus/discount lines (new lines only) to specific orders
ALTER TABLE public.courier_goods_custody_lines
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cgcl_order_id ON public.courier_goods_custody_lines(order_id);

-- 3) Order-based custody assignments (orders handed to a courier under a custody)
CREATE TABLE IF NOT EXISTS public.courier_order_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custody_id uuid NOT NULL REFERENCES public.courier_goods_custodies(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  courier_name text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'with_courier'
    CHECK (status IN ('with_courier','delivered','collected','completed','partially_returned','fully_returned','cancelled')),
  delivered_at timestamptz,
  collected_at timestamptz,
  returned_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.courier_order_assignments TO authenticated;
GRANT ALL ON public.courier_order_assignments TO service_role;

ALTER TABLE public.courier_order_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read order assignments"
  ON public.courier_order_assignments FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth insert order assignments"
  ON public.courier_order_assignments FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth update order assignments"
  ON public.courier_order_assignments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "managers delete order assignments"
  ON public.courier_order_assignments FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_coa_custody ON public.courier_order_assignments(custody_id);
CREATE INDEX IF NOT EXISTS idx_coa_courier ON public.courier_order_assignments(courier_name);
CREATE INDEX IF NOT EXISTS idx_coa_status  ON public.courier_order_assignments(status);

CREATE OR REPLACE FUNCTION public.tg_coa_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_coa_updated_at ON public.courier_order_assignments;
CREATE TRIGGER trg_coa_updated_at BEFORE UPDATE ON public.courier_order_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_coa_touch_updated_at();
