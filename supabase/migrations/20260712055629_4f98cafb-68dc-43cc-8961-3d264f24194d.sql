
-- Live ostrich sales (independent of slaughter batches)
CREATE TABLE public.slaughter_live_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number text NOT NULL UNIQUE,
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  live_receipt_id uuid NOT NULL REFERENCES public.slaughter_live_receipts(id) ON DELETE RESTRICT,
  live_bird_id uuid REFERENCES public.slaughter_live_birds(id) ON DELETE SET NULL,
  bird_count integer NOT NULL DEFAULT 1 CHECK (bird_count > 0),
  sale_weight_kg numeric NOT NULL CHECK (sale_weight_kg > 0),
  price_per_kg numeric NOT NULL CHECK (price_per_kg >= 0),
  total_sale numeric GENERATED ALWAYS AS (sale_weight_kg * price_per_kg) STORED,
  unit_cost_at_sale numeric NOT NULL DEFAULT 0,
  total_cost_at_sale numeric NOT NULL DEFAULT 0,
  breakeven_per_kg numeric NOT NULL DEFAULT 0,
  net_profit numeric GENERATED ALWAYS AS (sale_weight_kg * price_per_kg - total_cost_at_sale) STORED,
  cost_source text NOT NULL DEFAULT 'batch_average' CHECK (cost_source IN ('per_bird','batch_average')),
  customer_name text,
  customer_phone text,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','credit','partial')),
  amount_paid numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.slaughter_live_sales TO authenticated;
GRANT ALL ON public.slaughter_live_sales TO service_role;

ALTER TABLE public.slaughter_live_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view live sales"
  ON public.slaughter_live_sales FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "manage live sales"
  ON public.slaughter_live_sales FOR ALL
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'slaughterhouse_manager'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'slaughterhouse_manager'::app_role]));

CREATE INDEX idx_live_sales_receipt ON public.slaughter_live_sales(live_receipt_id);
CREATE INDEX idx_live_sales_date ON public.slaughter_live_sales(sale_date DESC);

-- Trigger: decrement available birds on the source receipt
CREATE OR REPLACE FUNCTION public.apply_live_sale_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.slaughter_live_receipts
       SET current_alive_count = GREATEST(0, current_alive_count - NEW.bird_count),
           updated_at = now()
     WHERE id = NEW.live_receipt_id;
    NEW.updated_at = now();
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.slaughter_live_receipts
       SET current_alive_count = current_alive_count + OLD.bird_count,
           updated_at = now()
     WHERE id = OLD.live_receipt_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_live_sale_stock
BEFORE INSERT ON public.slaughter_live_sales
FOR EACH ROW EXECUTE FUNCTION public.apply_live_sale_stock();

CREATE TRIGGER trg_live_sale_stock_delete
AFTER DELETE ON public.slaughter_live_sales
FOR EACH ROW EXECUTE FUNCTION public.apply_live_sale_stock();

-- Update trigger for updated_at
CREATE TRIGGER trg_live_sales_updated_at
BEFORE UPDATE ON public.slaughter_live_sales
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Availability view
CREATE OR REPLACE VIEW public.v_available_live_ostrich
WITH (security_invoker=on) AS
SELECT
  r.id AS receipt_id,
  r.receipt_number,
  r.receipt_date,
  r.source_name,
  r.bird_count AS original_count,
  r.current_alive_count,
  r.total_weight_kg,
  r.avg_weight_kg,
  r.price_per_kg,
  r.total_batch_cost,
  r.cost_per_bird_current,
  r.feed_cost_loaded,
  r.other_costs_loaded,
  COALESCE((SELECT SUM(bird_count) FROM public.slaughter_live_sales s WHERE s.live_receipt_id = r.id), 0)::int AS sold_live_count,
  COALESCE((SELECT SUM(sale_weight_kg) FROM public.slaughter_live_sales s WHERE s.live_receipt_id = r.id), 0)::numeric AS sold_live_weight_kg
FROM public.slaughter_live_receipts r
WHERE r.archived = false;

GRANT SELECT ON public.v_available_live_ostrich TO authenticated;
