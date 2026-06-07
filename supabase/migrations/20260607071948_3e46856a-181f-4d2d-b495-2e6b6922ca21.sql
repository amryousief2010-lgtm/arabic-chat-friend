
-- =========================================================
-- Private Courier Module — independent tables (no touch to orders)
-- =========================================================

-- ----- ENUMS -----
DO $$ BEGIN
  CREATE TYPE public.pc_courier_status AS ENUM (
    'assigned_to_courier',
    'ready_for_pickup_from_main_warehouse',
    'picked_up_by_courier',
    'out_for_delivery',
    'delivered',
    'failed_delivery',
    'returned_to_warehouse',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pc_route_status AS ENUM (
    'draft','planned','in_progress','completed','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pc_collection_status AS ENUM (
    'cash_collected','partial_collected','not_collected','mismatch','paid_online','returned_no_collection'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pc_failed_reason AS ENUM (
    'customer_unavailable','address_unclear','customer_refused','customer_postponed',
    'product_unsuitable','wrong_phone','out_of_delivery_area','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pc_next_action AS ENUM (
    'reschedule','return_to_warehouse','cancel_order','manager_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----- updated_at helper (reuse global if exists) -----
CREATE OR REPLACE FUNCTION public.pc_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- =========================================================
-- 1) pc_routes
-- =========================================================
CREATE TABLE IF NOT EXISTS public.pc_routes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  region          text,
  governorates    text[] NOT NULL DEFAULT '{}',
  cities          text[] NOT NULL DEFAULT '{}',
  assigned_courier_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  planned_date    date,
  start_time      time,
  expected_end_time time,
  status          public.pc_route_status NOT NULL DEFAULT 'draft',
  color           text DEFAULT '#8b5cf6',
  notes           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_routes TO authenticated;
GRANT ALL ON public.pc_routes TO service_role;
ALTER TABLE public.pc_routes ENABLE ROW LEVEL SECURITY;

-- Managers full access; courier can SELECT routes assigned to him
CREATE POLICY pc_routes_mgr_all ON public.pc_routes
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE POLICY pc_routes_courier_read ON public.pc_routes
  FOR SELECT TO authenticated
  USING (assigned_courier_id = auth.uid());

CREATE POLICY pc_routes_warehouse_read ON public.pc_routes
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['warehouse_supervisor'::app_role,'accountant'::app_role]));

CREATE TRIGGER pc_routes_set_updated_at BEFORE UPDATE ON public.pc_routes
  FOR EACH ROW EXECUTE FUNCTION public.pc_set_updated_at();

-- =========================================================
-- 2) pc_route_orders
-- =========================================================
CREATE TABLE IF NOT EXISTS public.pc_route_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id        uuid NOT NULL REFERENCES public.pc_routes(id) ON DELETE CASCADE,
  order_id        uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  sequence        int  NOT NULL DEFAULT 0,
  expected_delivery_at timestamptz,
  added_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pc_route_orders_route_idx ON public.pc_route_orders(route_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_route_orders TO authenticated;
GRANT ALL ON public.pc_route_orders TO service_role;
ALTER TABLE public.pc_route_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY pc_ro_mgr_all ON public.pc_route_orders
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE POLICY pc_ro_courier_read ON public.pc_route_orders
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pc_routes r WHERE r.id = route_id AND r.assigned_courier_id = auth.uid()));

CREATE POLICY pc_ro_warehouse_read ON public.pc_route_orders
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['warehouse_supervisor'::app_role,'accountant'::app_role]));

-- =========================================================
-- 3) pc_order_tracking
-- =========================================================
CREATE TABLE IF NOT EXISTS public.pc_order_tracking (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  courier_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  courier_status  public.pc_courier_status NOT NULL DEFAULT 'assigned_to_courier',
  delivered_at    timestamptz,
  last_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pc_tracking_courier_idx ON public.pc_order_tracking(courier_id);
CREATE INDEX IF NOT EXISTS pc_tracking_status_idx ON public.pc_order_tracking(courier_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_order_tracking TO authenticated;
GRANT ALL ON public.pc_order_tracking TO service_role;
ALTER TABLE public.pc_order_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY pc_track_mgr_all ON public.pc_order_tracking
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE POLICY pc_track_courier_rw ON public.pc_order_tracking
  FOR SELECT TO authenticated USING (courier_id = auth.uid());
CREATE POLICY pc_track_courier_update ON public.pc_order_tracking
  FOR UPDATE TO authenticated USING (courier_id = auth.uid()) WITH CHECK (courier_id = auth.uid());

CREATE POLICY pc_track_warehouse_read ON public.pc_order_tracking
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['warehouse_supervisor'::app_role,'accountant'::app_role]));

CREATE TRIGGER pc_track_set_updated_at BEFORE UPDATE ON public.pc_order_tracking
  FOR EACH ROW EXECUTE FUNCTION public.pc_set_updated_at();

-- =========================================================
-- 4) pc_handovers
-- =========================================================
CREATE TABLE IF NOT EXISTS public.pc_handovers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  prepared_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prepared_at     timestamptz,
  handed_over_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handed_over_at  timestamptz,
  courier_received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  courier_received_at timestamptz,
  checklist_confirmed boolean NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_handovers TO authenticated;
GRANT ALL ON public.pc_handovers TO service_role;
ALTER TABLE public.pc_handovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY pc_handover_mgr_all ON public.pc_handovers
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role,'warehouse_supervisor'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role,'warehouse_supervisor'::app_role]));

CREATE POLICY pc_handover_courier_rw ON public.pc_handovers
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pc_order_tracking t WHERE t.order_id = pc_handovers.order_id AND t.courier_id = auth.uid()));

CREATE POLICY pc_handover_courier_update ON public.pc_handovers
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pc_order_tracking t WHERE t.order_id = pc_handovers.order_id AND t.courier_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pc_order_tracking t WHERE t.order_id = pc_handovers.order_id AND t.courier_id = auth.uid()));

CREATE POLICY pc_handover_accountant_read ON public.pc_handovers
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'accountant'::app_role));

CREATE TRIGGER pc_handover_set_updated_at BEFORE UPDATE ON public.pc_handovers
  FOR EACH ROW EXECUTE FUNCTION public.pc_set_updated_at();

-- =========================================================
-- 5) pc_collections
-- =========================================================
CREATE TABLE IF NOT EXISTS public.pc_collections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  amount_due      numeric(12,2) NOT NULL DEFAULT 0,
  amount_collected numeric(12,2) NOT NULL DEFAULT 0,
  status          public.pc_collection_status NOT NULL DEFAULT 'not_collected',
  difference      numeric(12,2) GENERATED ALWAYS AS (amount_collected - amount_due) STORED,
  notes           text,
  collected_at    timestamptz,
  collected_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_collections TO authenticated;
GRANT ALL ON public.pc_collections TO service_role;
ALTER TABLE public.pc_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY pc_coll_mgr_all ON public.pc_collections
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role,'accountant'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE POLICY pc_coll_courier_rw ON public.pc_collections
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pc_order_tracking t WHERE t.order_id = pc_collections.order_id AND t.courier_id = auth.uid()));

CREATE POLICY pc_coll_courier_insert ON public.pc_collections
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.pc_order_tracking t WHERE t.order_id = pc_collections.order_id AND t.courier_id = auth.uid()));

CREATE POLICY pc_coll_courier_update ON public.pc_collections
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pc_order_tracking t WHERE t.order_id = pc_collections.order_id AND t.courier_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pc_order_tracking t WHERE t.order_id = pc_collections.order_id AND t.courier_id = auth.uid()));

CREATE TRIGGER pc_coll_set_updated_at BEFORE UPDATE ON public.pc_collections
  FOR EACH ROW EXECUTE FUNCTION public.pc_set_updated_at();

-- =========================================================
-- 6) pc_failed_attempts
-- =========================================================
CREATE TABLE IF NOT EXISTS public.pc_failed_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reason          public.pc_failed_reason NOT NULL,
  notes           text NOT NULL,
  next_action     public.pc_next_action NOT NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pc_failed_order_idx ON public.pc_failed_attempts(order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_failed_attempts TO authenticated;
GRANT ALL ON public.pc_failed_attempts TO service_role;
ALTER TABLE public.pc_failed_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY pc_fail_mgr_all ON public.pc_failed_attempts
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role,'accountant'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE POLICY pc_fail_courier_rw ON public.pc_failed_attempts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pc_order_tracking t WHERE t.order_id = pc_failed_attempts.order_id AND t.courier_id = auth.uid()));

CREATE POLICY pc_fail_courier_insert ON public.pc_failed_attempts
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.pc_order_tracking t WHERE t.order_id = pc_failed_attempts.order_id AND t.courier_id = auth.uid()));

-- =========================================================
-- RPC: list eligible private-courier orders (managers only)
-- =========================================================
CREATE OR REPLACE FUNCTION public.pc_list_eligible_orders()
RETURNS TABLE (
  id uuid,
  order_number text,
  status text,
  total numeric,
  payment_method text,
  payment_status text,
  created_at timestamptz,
  delivery_address text,
  notes text,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  customer_governorate text,
  assigned_route_id uuid,
  tracking_status public.pc_courier_status,
  tracking_courier_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role,'warehouse_supervisor'::app_role,'accountant'::app_role]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT o.id, o.order_number, o.status::text, o.total, o.payment_method::text, o.payment_status::text,
         o.created_at, o.delivery_address, o.notes,
         c.id, c.name, c.phone, c.governorate,
         ro.route_id, t.courier_status, t.courier_id
  FROM public.orders o
  JOIN public.warehouses w ON w.id = o.source_warehouse_id
  LEFT JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.pc_route_orders ro ON ro.order_id = o.id
  LEFT JOIN public.pc_order_tracking t ON t.order_id = o.id
  WHERE o.shipping_company = 'مندوب خاص'
    AND o.fulfillment_type = 'delivery'
    AND (w.name ILIKE '%الرئيسي%' OR w.name ILIKE '%المقر%')
  ORDER BY o.created_at DESC
  LIMIT 1000;
END $$;

GRANT EXECUTE ON FUNCTION public.pc_list_eligible_orders() TO authenticated;

-- =========================================================
-- RPC: courier's assigned orders
-- =========================================================
CREATE OR REPLACE FUNCTION public.pc_get_my_assigned_orders()
RETURNS TABLE (
  id uuid,
  order_number text,
  status text,
  total numeric,
  payment_method text,
  payment_status text,
  created_at timestamptz,
  delivery_address text,
  notes text,
  customer_name text,
  customer_phone text,
  customer_governorate text,
  route_id uuid,
  route_name text,
  tracking_status public.pc_courier_status,
  collection_status public.pc_collection_status,
  amount_collected numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  SELECT o.id, o.order_number, o.status::text, o.total, o.payment_method::text, o.payment_status::text,
         o.created_at, o.delivery_address, o.notes,
         c.name, c.phone, c.governorate,
         t.id AS route_id_placeholder, r.name AS route_name,
         t.courier_status, col.status, col.amount_collected
  FROM public.pc_order_tracking t
  JOIN public.orders o ON o.id = t.order_id
  LEFT JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.pc_route_orders ro ON ro.order_id = o.id
  LEFT JOIN public.pc_routes r ON r.id = ro.route_id
  LEFT JOIN public.pc_collections col ON col.order_id = o.id
  WHERE t.courier_id = auth.uid()
  ORDER BY o.created_at DESC
  LIMIT 1000;
END $$;

GRANT EXECUTE ON FUNCTION public.pc_get_my_assigned_orders() TO authenticated;

-- =========================================================
-- RPC: assign order to route + courier
-- =========================================================
CREATE OR REPLACE FUNCTION public.pc_assign_order_to_route(
  p_route_id uuid,
  p_order_id uuid,
  p_sequence int DEFAULT 0,
  p_expected_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_courier uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT assigned_courier_id INTO v_courier FROM public.pc_routes WHERE id = p_route_id;

  -- upsert link
  INSERT INTO public.pc_route_orders(route_id, order_id, sequence, expected_delivery_at, added_by)
  VALUES (p_route_id, p_order_id, p_sequence, p_expected_at, auth.uid())
  ON CONFLICT (order_id) DO UPDATE
    SET route_id = EXCLUDED.route_id,
        sequence = EXCLUDED.sequence,
        expected_delivery_at = EXCLUDED.expected_delivery_at,
        added_by = auth.uid();

  -- upsert tracking
  INSERT INTO public.pc_order_tracking(order_id, courier_id, courier_status, last_updated_by)
  VALUES (p_order_id, v_courier, 'assigned_to_courier', auth.uid())
  ON CONFLICT (order_id) DO UPDATE
    SET courier_id = COALESCE(EXCLUDED.courier_id, public.pc_order_tracking.courier_id),
        courier_status = CASE
          WHEN public.pc_order_tracking.courier_status = 'delivered' THEN public.pc_order_tracking.courier_status
          ELSE 'assigned_to_courier'::public.pc_courier_status
        END,
        last_updated_by = auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.pc_assign_order_to_route(uuid,uuid,int,timestamptz) TO authenticated;
