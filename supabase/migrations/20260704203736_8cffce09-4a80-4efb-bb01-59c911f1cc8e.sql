
-- 1) Orders extensions
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_bill_no TEXT,
  ADD COLUMN IF NOT EXISTS zodex_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS zodex_return_amount NUMERIC;

CREATE UNIQUE INDEX IF NOT EXISTS orders_shipping_bill_no_uidx
  ON public.orders(shipping_bill_no) WHERE shipping_bill_no IS NOT NULL;

-- 2) Missing orders reported by Zodex sync
CREATE TABLE IF NOT EXISTS public.zodex_missing_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no TEXT NOT NULL UNIQUE,
  customer_name TEXT,
  customer_phone TEXT,
  region TEXT,
  cod_amount NUMERIC,
  moderator_name TEXT,
  zodex_status TEXT,
  shipment_date TIMESTAMPTZ,
  operation_type TEXT,
  raw_row JSONB,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | resolved | ignored
  resolved_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  ignored_reason TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.zodex_missing_orders TO authenticated;
GRANT ALL ON public.zodex_missing_orders TO service_role;

ALTER TABLE public.zodex_missing_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read missing" ON public.zodex_missing_orders
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update missing" ON public.zodex_missing_orders
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS zodex_missing_status_idx ON public.zodex_missing_orders(status);

-- 3) Sync runs log
CREATE TABLE IF NOT EXISTS public.zodex_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by UUID,
  trigger_source TEXT NOT NULL DEFAULT 'manual', -- manual | schedule
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running', -- running | success | error
  total_rows INTEGER NOT NULL DEFAULT 0,
  delivered_matched INTEGER NOT NULL DEFAULT 0,
  returned_matched INTEGER NOT NULL DEFAULT 0,
  missing_created INTEGER NOT NULL DEFAULT 0,
  missing_updated INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.zodex_sync_runs TO authenticated;
GRANT ALL ON public.zodex_sync_runs TO service_role;

ALTER TABLE public.zodex_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read runs" ON public.zodex_sync_runs
  FOR SELECT TO authenticated USING (true);

-- 4) updated_at trigger for missing orders
CREATE OR REPLACE FUNCTION public.zodex_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS zodex_missing_touch ON public.zodex_missing_orders;
CREATE TRIGGER zodex_missing_touch
  BEFORE UPDATE ON public.zodex_missing_orders
  FOR EACH ROW EXECUTE FUNCTION public.zodex_touch_updated_at();
