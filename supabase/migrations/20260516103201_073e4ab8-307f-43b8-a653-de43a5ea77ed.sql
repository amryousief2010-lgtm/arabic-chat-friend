
-- 1) Branches table
CREATE TABLE IF NOT EXISTS public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  manager_id uuid,
  address text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view branches" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage branches" ON public.branches FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]));

CREATE TRIGGER trg_branches_updated BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO public.branches (code, name_ar) VALUES
  ('HELIO','هليوبوليس'),
  ('CARFR','كارفور')
ON CONFLICT (code) DO NOTHING;

-- 2) Per-bird detail rows
CREATE TABLE IF NOT EXISTS public.slaughter_live_birds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.slaughter_live_receipts(id) ON DELETE CASCADE,
  bird_index integer NOT NULL,
  live_weight_kg numeric NOT NULL DEFAULT 0,
  slaughter_weight_kg numeric NOT NULL DEFAULT 0,
  purchase_cost numeric NOT NULL DEFAULT 0,
  purchase_time time,
  feed_cost numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slaughter_live_birds_receipt ON public.slaughter_live_birds(receipt_id);
ALTER TABLE public.slaughter_live_birds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view live birds" ON public.slaughter_live_birds FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage live birds" ON public.slaughter_live_birds FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role]));

-- Aggregate trigger on bird changes -> update receipt totals
CREATE OR REPLACE FUNCTION public.aggregate_slaughter_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rid uuid;
BEGIN
  rid := COALESCE(NEW.receipt_id, OLD.receipt_id);
  UPDATE public.slaughter_live_receipts r
  SET bird_count = COALESCE((SELECT COUNT(*) FROM public.slaughter_live_birds WHERE receipt_id = rid AND live_weight_kg > 0), 0),
      total_weight_kg = COALESCE((SELECT SUM(live_weight_kg) FROM public.slaughter_live_birds WHERE receipt_id = rid), 0),
      price_per_kg = CASE WHEN COALESCE((SELECT SUM(live_weight_kg) FROM public.slaughter_live_birds WHERE receipt_id = rid),0) > 0
                          THEN COALESCE((SELECT SUM(purchase_cost+feed_cost) FROM public.slaughter_live_birds WHERE receipt_id = rid),0)
                               / NULLIF((SELECT SUM(live_weight_kg) FROM public.slaughter_live_birds WHERE receipt_id = rid),0)
                          ELSE r.price_per_kg END
  WHERE r.id = rid;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_birds_aggregate
AFTER INSERT OR UPDATE OR DELETE ON public.slaughter_live_birds
FOR EACH ROW EXECUTE FUNCTION public.aggregate_slaughter_receipt();

-- 3) Extend batch outputs with branch + sale price
ALTER TABLE public.slaughter_batch_outputs
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_price numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_slaughter_outputs_branch ON public.slaughter_batch_outputs(branch_id);

-- 4) Branch transfers (links outputs into branch inventory flow)
CREATE TABLE IF NOT EXISTS public.slaughter_branch_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.slaughter_batches(id) ON DELETE CASCADE,
  output_id uuid REFERENCES public.slaughter_batch_outputs(id) ON DELETE SET NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  cut_name_ar text NOT NULL,
  weight_kg numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  total_value numeric GENERATED ALWAYS AS (weight_kg * unit_price) STORED,
  transferred_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','rejected')),
  received_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transfers_batch ON public.slaughter_branch_transfers(batch_id);
CREATE INDEX IF NOT EXISTS idx_transfers_branch ON public.slaughter_branch_transfers(branch_id);
ALTER TABLE public.slaughter_branch_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view branch transfers" ON public.slaughter_branch_transfers FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage branch transfers" ON public.slaughter_branch_transfers FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role,'warehouse_supervisor'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role,'warehouse_supervisor'::app_role]));

-- 5) Finalize batch: compute yield/cost + create transfers per output that has branch
CREATE OR REPLACE FUNCTION public.finalize_slaughter_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.slaughter_batches%ROWTYPE;
  v_meat numeric := 0;
  v_total_purchase numeric := 0;
  v_cost_per_kg numeric := 0;
  v_transfers int := 0;
BEGIN
  SELECT * INTO v_batch FROM public.slaughter_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;

  SELECT COALESCE(SUM(actual_weight_kg),0) INTO v_meat
  FROM public.slaughter_batch_outputs WHERE batch_id = p_batch_id;

  IF v_batch.live_receipt_id IS NOT NULL THEN
    SELECT COALESCE(total_cost,0) + COALESCE((
      SELECT SUM(feed_cost) FROM public.slaughter_live_birds WHERE receipt_id = v_batch.live_receipt_id
    ),0) INTO v_total_purchase
    FROM public.slaughter_live_receipts WHERE id = v_batch.live_receipt_id;
  END IF;

  IF v_meat > 0 THEN v_cost_per_kg := v_total_purchase / v_meat; END IF;

  UPDATE public.slaughter_batches
  SET total_meat_kg = v_meat,
      cost_per_kg_meat = v_cost_per_kg,
      status = 'completed',
      end_time = COALESCE(end_time, CURRENT_TIME)
  WHERE id = p_batch_id;

  -- Update unit_cost on outputs
  UPDATE public.slaughter_batch_outputs
  SET unit_cost = v_cost_per_kg,
      total_cost = actual_weight_kg * v_cost_per_kg
  WHERE batch_id = p_batch_id;

  -- Create transfers for outputs with branch (idempotent: skip existing)
  INSERT INTO public.slaughter_branch_transfers (batch_id, output_id, branch_id, cut_name_ar, weight_kg, unit_price)
  SELECT o.batch_id, o.id, o.branch_id, o.cut_name_ar, o.actual_weight_kg, o.unit_price
  FROM public.slaughter_batch_outputs o
  WHERE o.batch_id = p_batch_id
    AND o.branch_id IS NOT NULL
    AND o.actual_weight_kg > 0
    AND NOT EXISTS (SELECT 1 FROM public.slaughter_branch_transfers t WHERE t.output_id = o.id);
  GET DIAGNOSTICS v_transfers = ROW_COUNT;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'total_meat_kg', v_meat,
    'total_purchase_cost', v_total_purchase,
    'cost_per_kg_meat', v_cost_per_kg,
    'transfers_created', v_transfers
  );
END;
$$;

-- 6) Daily summary RPC
CREATE OR REPLACE FUNCTION public.slaughter_daily_summary(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'date', p_date,
    'receipts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'receipt_number', r.receipt_number,
        'bird_count', r.bird_count, 'total_weight_kg', r.total_weight_kg,
        'total_cost', r.total_cost,
        'birds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'bird_index', b.bird_index, 'live_weight_kg', b.live_weight_kg,
          'slaughter_weight_kg', b.slaughter_weight_kg,
          'purchase_cost', b.purchase_cost, 'purchase_time', b.purchase_time,
          'feed_cost', b.feed_cost) ORDER BY b.bird_index)
          FROM public.slaughter_live_birds b WHERE b.receipt_id = r.id), '[]'::jsonb)
      )) FROM public.slaughter_live_receipts r WHERE r.receipt_date = p_date), '[]'::jsonb),
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', bt.id, 'batch_number', bt.batch_number,
        'total_live_weight_kg', bt.total_live_weight_kg,
        'total_meat_kg', bt.total_meat_kg,
        'actual_yield_pct', bt.actual_yield_pct,
        'cost_per_kg_meat', bt.cost_per_kg_meat,
        'outputs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'cut_name_ar', o.cut_name_ar, 'actual_weight_kg', o.actual_weight_kg,
          'unit_price', o.unit_price, 'branch_id', o.branch_id))
          FROM public.slaughter_batch_outputs o WHERE o.batch_id = bt.id), '[]'::jsonb)
      )) FROM public.slaughter_batches bt WHERE bt.slaughter_date = p_date), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
