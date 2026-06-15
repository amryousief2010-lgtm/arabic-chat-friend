
ALTER TABLE public.hatchery_client_invoices
  ADD COLUMN IF NOT EXISTS carryover_out_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS carryover_in_amount  numeric NOT NULL DEFAULT 0;

ALTER TABLE public.hatchery_client_invoices DROP COLUMN IF EXISTS remaining_amount CASCADE;
ALTER TABLE public.hatchery_client_invoices
  ADD COLUMN remaining_amount numeric
  GENERATED ALWAYS AS (total_amount + carryover_in_amount - paid_amount - discount_amount - carryover_out_amount) STORED;

-- Recreate views
CREATE OR REPLACE VIEW public.v_hatchery_client_balances AS
SELECT c.id AS client_id,
       c.name AS client_name,
       count(i.id) AS invoices_count,
       COALESCE(sum(i.total_amount), 0::numeric) AS total_amount,
       COALESCE(sum(i.paid_amount), 0::numeric) AS paid_amount,
       COALESCE(sum(i.discount_amount), 0::numeric) AS discount_amount,
       COALESCE(sum(i.remaining_amount), 0::numeric) AS remaining_amount
  FROM public.hatch_customers c
  LEFT JOIN public.hatchery_client_invoices i ON i.client_id = c.id
 GROUP BY c.id, c.name;

CREATE OR REPLACE VIEW public.v_hatchery_dashboard_kpis AS
WITH s AS (
  SELECT * FROM public.hatchery_pricing_settings ORDER BY updated_at DESC LIMIT 1
), lots AS (
  SELECT l.*, b.status AS batch_status, b.entry_date
    FROM public.hatchery_batch_lots l
    JOIN public.hatchery_batches b ON b.id = l.batch_id
   WHERE NOT l.cancelled AND b.status <> 'cancelled'
)
SELECT
  (SELECT COALESCE(sum(eggs_in),0) FROM lots WHERE batch_status = ANY(ARRAY['incubating','candled'])) AS eggs_in_incubators,
  (SELECT COALESCE(sum(eggs_in),0) FROM lots WHERE owner_type='capital_ostrich' AND batch_status = ANY(ARRAY['incubating','candled'])) AS internal_eggs,
  (SELECT COALESCE(sum(eggs_in),0) FROM lots WHERE owner_type='external_client' AND batch_status = ANY(ARRAY['incubating','candled'])) AS external_eggs,
  (SELECT count(DISTINCT l.batch_id) FROM lots l, s WHERE l.batch_status='incubating' AND l.candling_recorded_at IS NULL AND (l.entry_date + s.candling_day) <= CURRENT_DATE) AS batches_awaiting_candling,
  (SELECT count(DISTINCT l.batch_id) FROM lots l, s WHERE l.batch_status = ANY(ARRAY['incubating','candled']) AND l.transferred_to_hatcher_at IS NULL AND (l.entry_date + s.transfer_to_hatcher_day) <= CURRENT_DATE) AS batches_awaiting_hatcher,
  (SELECT COALESCE(sum(transferred_count),0) FROM lots WHERE batch_status='in_hatcher') AS in_hatcher,
  (SELECT COALESCE(sum(chicks_hatched),0) FROM lots WHERE brooding_in_at IS NOT NULL AND brooding_out_at IS NULL) AS in_brooding,
  (SELECT COALESCE(sum(chicks_hatched),0) FROM lots WHERE hatcher_out_at >= date_trunc('month', now())) AS chicks_this_month,
  (SELECT CASE WHEN sum(fertile_eggs)>0 THEN round(sum(chicks_hatched)::numeric / sum(fertile_eggs)::numeric * 100, 1) ELSE 0 END FROM lots WHERE fertile_eggs IS NOT NULL) AS hatch_rate_pct,
  (SELECT COALESCE(sum(total_amount),0) FROM public.hatchery_client_invoices) AS invoices_total,
  (SELECT COALESCE(sum(paid_amount),0) FROM public.hatchery_client_invoices) AS invoices_paid,
  (SELECT COALESCE(sum(discount_amount),0) FROM public.hatchery_client_invoices) AS invoices_discount,
  (SELECT COALESCE(sum(remaining_amount),0) FROM public.hatchery_client_invoices) AS invoices_remaining;

GRANT SELECT ON public.v_hatchery_client_balances TO authenticated, anon;
GRANT SELECT ON public.v_hatchery_dashboard_kpis TO authenticated, anon;

-- Recalc function update
CREATE OR REPLACE FUNCTION public.hatchery_recalc_invoice_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_paid numeric; v_disc numeric; v_total numeric; v_inv uuid;
  v_cout numeric; v_cin numeric;
BEGIN
  v_inv := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.hatchery_invoice_payments WHERE invoice_id = v_inv;
  SELECT COALESCE(SUM(amount),0) INTO v_disc FROM public.hatchery_invoice_discounts WHERE invoice_id = v_inv;
  SELECT total_amount, carryover_out_amount, carryover_in_amount
    INTO v_total, v_cout, v_cin
    FROM public.hatchery_client_invoices WHERE id = v_inv;
  UPDATE public.hatchery_client_invoices SET
    paid_amount = v_paid,
    discount_amount = v_disc,
    payment_status = CASE
      WHEN (v_paid + v_disc + COALESCE(v_cout,0)) <= 0 THEN 'unpaid'
      WHEN (v_paid + v_disc + COALESCE(v_cout,0)) >= COALESCE(v_total,0) + COALESCE(v_cin,0) THEN 'paid'
      ELSE 'partial'
    END
  WHERE id = v_inv;
  RETURN COALESCE(NEW, OLD);
END $function$;

-- Carryover table
CREATE TABLE IF NOT EXISTS public.hatchery_invoice_carryovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid,
  source_invoice_id uuid NOT NULL REFERENCES public.hatchery_client_invoices(id) ON DELETE CASCADE,
  applied_to_invoice_id uuid REFERENCES public.hatchery_client_invoices(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','cancelled')),
  reason text,
  notes text,
  created_by uuid,
  applied_by uuid,
  cancelled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hic_one_open_per_source
  ON public.hatchery_invoice_carryovers(source_invoice_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_hic_client ON public.hatchery_invoice_carryovers(client_id);
CREATE INDEX IF NOT EXISTS idx_hic_applied_to ON public.hatchery_invoice_carryovers(applied_to_invoice_id);
CREATE INDEX IF NOT EXISTS idx_hic_status ON public.hatchery_invoice_carryovers(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hatchery_invoice_carryovers TO authenticated;
GRANT ALL ON public.hatchery_invoice_carryovers TO service_role;

ALTER TABLE public.hatchery_invoice_carryovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carryovers select all authenticated"
  ON public.hatchery_invoice_carryovers FOR SELECT TO authenticated USING (true);

CREATE POLICY "carryovers insert authenticated"
  ON public.hatchery_invoice_carryovers FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "carryovers update managers"
  ON public.hatchery_invoice_carryovers FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
    OR public.has_role(auth.uid(), 'hatchery_manager'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
  );

CREATE POLICY "carryovers delete managers"
  ON public.hatchery_invoice_carryovers FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
  );

CREATE OR REPLACE FUNCTION public.touch_hic_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_hic_updated ON public.hatchery_invoice_carryovers;
CREATE TRIGGER trg_hic_updated BEFORE UPDATE ON public.hatchery_invoice_carryovers
  FOR EACH ROW EXECUTE FUNCTION public.touch_hic_updated_at();

CREATE OR REPLACE FUNCTION public.hatchery_recalc_invoice_carryovers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_src uuid; v_tgt uuid;
  v_old_src uuid; v_old_tgt uuid;
  v_total numeric; v_paid numeric; v_disc numeric; v_cin numeric; v_cout numeric;
  v_inv uuid;
BEGIN
  v_src := COALESCE(NEW.source_invoice_id, OLD.source_invoice_id);
  v_tgt := COALESCE(NEW.applied_to_invoice_id, OLD.applied_to_invoice_id);
  v_old_src := OLD.source_invoice_id;
  v_old_tgt := OLD.applied_to_invoice_id;

  FOR v_inv IN SELECT DISTINCT i FROM unnest(ARRAY[v_src, v_old_src]) AS i WHERE i IS NOT NULL
  LOOP
    UPDATE public.hatchery_client_invoices
      SET carryover_out_amount = COALESCE((
        SELECT SUM(amount) FROM public.hatchery_invoice_carryovers
         WHERE source_invoice_id = v_inv AND status IN ('open','applied')
      ), 0)
    WHERE id = v_inv;
  END LOOP;

  FOR v_inv IN SELECT DISTINCT i FROM unnest(ARRAY[v_tgt, v_old_tgt]) AS i WHERE i IS NOT NULL
  LOOP
    UPDATE public.hatchery_client_invoices
      SET carryover_in_amount = COALESCE((
        SELECT SUM(amount) FROM public.hatchery_invoice_carryovers
         WHERE applied_to_invoice_id = v_inv AND status = 'applied'
      ), 0)
    WHERE id = v_inv;
  END LOOP;

  FOR v_inv IN SELECT DISTINCT i FROM unnest(ARRAY[v_src, v_old_src, v_tgt, v_old_tgt]) AS i WHERE i IS NOT NULL
  LOOP
    SELECT total_amount, paid_amount, discount_amount, carryover_in_amount, carryover_out_amount
      INTO v_total, v_paid, v_disc, v_cin, v_cout
      FROM public.hatchery_client_invoices WHERE id = v_inv;
    UPDATE public.hatchery_client_invoices SET
      payment_status = CASE
        WHEN (COALESCE(v_paid,0) + COALESCE(v_disc,0) + COALESCE(v_cout,0)) <= 0 THEN 'unpaid'
        WHEN (COALESCE(v_paid,0) + COALESCE(v_disc,0) + COALESCE(v_cout,0)) >= COALESCE(v_total,0) + COALESCE(v_cin,0) THEN 'paid'
        ELSE 'partial'
      END
    WHERE id = v_inv;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_hic_recalc ON public.hatchery_invoice_carryovers;
CREATE TRIGGER trg_hic_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.hatchery_invoice_carryovers
  FOR EACH ROW EXECUTE FUNCTION public.hatchery_recalc_invoice_carryovers();
