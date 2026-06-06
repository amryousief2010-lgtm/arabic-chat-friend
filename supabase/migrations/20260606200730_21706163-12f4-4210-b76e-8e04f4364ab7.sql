
-- 1) Delivery routes table
CREATE TABLE IF NOT EXISTS public.delivery_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#a855f7',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_routes TO authenticated;
GRANT ALL ON public.delivery_routes TO service_role;

ALTER TABLE public.delivery_routes ENABLE ROW LEVEL SECURITY;

-- Kimo (specific user) can manage routes; all authenticated can view
CREATE POLICY "All authenticated can view delivery routes"
  ON public.delivery_routes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Kimo or GM can insert delivery routes"
  ON public.delivery_routes FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = '63f77f84-eb84-4e88-9d7d-468e2ca981b8'::uuid
    OR public.has_role(auth.uid(), 'general_manager')
  );

CREATE POLICY "Kimo or GM can update delivery routes"
  ON public.delivery_routes FOR UPDATE TO authenticated
  USING (
    auth.uid() = '63f77f84-eb84-4e88-9d7d-468e2ca981b8'::uuid
    OR public.has_role(auth.uid(), 'general_manager')
  );

CREATE POLICY "Kimo or GM can delete delivery routes"
  ON public.delivery_routes FOR DELETE TO authenticated
  USING (
    auth.uid() = '63f77f84-eb84-4e88-9d7d-468e2ca981b8'::uuid
    OR public.has_role(auth.uid(), 'general_manager')
  );

CREATE TRIGGER trg_delivery_routes_updated_at
  BEFORE UPDATE ON public.delivery_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Link orders to routes
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.delivery_routes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_route_id ON public.orders(route_id);

-- 3) Make customer phone visible to all authenticated users (read-only)
--    so the phone column shows up for every role that already sees the order.
CREATE POLICY "All authenticated can view customers"
  ON public.customers FOR SELECT TO authenticated USING (true);
