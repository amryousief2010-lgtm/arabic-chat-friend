
CREATE TABLE public.unregistered_bostta_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  cod NUMERIC NOT NULL DEFAULT 0,
  shipment_date DATE,
  raw_products TEXT,
  parsed_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  unknown_tokens JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','registered','dismissed')),
  uploaded_from_filename TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  registered_order_id UUID REFERENCES public.orders(id),
  registered_by UUID REFERENCES auth.users(id),
  registered_at TIMESTAMPTZ,
  dismissed_reason TEXT,
  dismissed_by UUID REFERENCES auth.users(id),
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unregistered_bostta_shipments TO authenticated;
GRANT ALL ON public.unregistered_bostta_shipments TO service_role;

ALTER TABLE public.unregistered_bostta_shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view unregistered shipments"
  ON public.unregistered_bostta_shipments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert unregistered shipments"
  ON public.unregistered_bostta_shipments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Moderators+ can update unregistered shipments"
  ON public.unregistered_bostta_shipments FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'sales_moderator'::app_role)
    OR public.has_role(auth.uid(), 'warehouse_supervisor'::app_role)
    OR public.has_role(auth.uid(), 'agouza_warehouse_keeper'::app_role)
    OR public.has_role(auth.uid(), 'general_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
    OR public.has_role(auth.uid(), 'sales_manager'::app_role)
    OR public.has_role(auth.uid(), 'marketing_sales_manager'::app_role)
  );

CREATE INDEX idx_unreg_ship_status ON public.unregistered_bostta_shipments(status, created_at DESC);
CREATE INDEX idx_unreg_ship_phone ON public.unregistered_bostta_shipments(phone);

CREATE TRIGGER trg_unreg_ship_updated
  BEFORE UPDATE ON public.unregistered_bostta_shipments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
