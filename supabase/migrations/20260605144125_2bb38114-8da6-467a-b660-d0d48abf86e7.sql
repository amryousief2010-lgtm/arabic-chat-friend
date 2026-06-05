
CREATE TABLE public.hatchery_pricing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  infertile_egg_price numeric NOT NULL DEFAULT 50,
  chick_price numeric NOT NULL DEFAULT 150,
  completed_unhatched_price numeric NOT NULL DEFAULT 100,
  daily_brooding_price numeric NOT NULL DEFAULT 15,
  candling_day integer NOT NULL DEFAULT 15,
  transfer_to_hatcher_day integer NOT NULL DEFAULT 39,
  hatcher_duration_hours integer NOT NULL DEFAULT 24,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hatchery_pricing_settings TO authenticated;
GRANT ALL ON public.hatchery_pricing_settings TO service_role;
ALTER TABLE public.hatchery_pricing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY hps_view ON public.hatchery_pricing_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY hps_manage ON public.hatchery_pricing_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'hatchery_manager'))
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'hatchery_manager'));
INSERT INTO public.hatchery_pricing_settings DEFAULT VALUES;

CREATE TABLE public.hatchery_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number text UNIQUE NOT NULL DEFAULT ('HB-' || to_char(now(),'YYMMDDHH24MISS')),
  entry_date date NOT NULL,
  batch_type text NOT NULL CHECK (batch_type IN ('internal','external','mixed')),
  incubator_machine_no text,
  notes text,
  status text NOT NULL DEFAULT 'incubating' CHECK (status IN ('incubating','candled','in_hatcher','in_brooding','closed','cancelled')),
  cancel_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.hatchery_batches TO authenticated;
GRANT ALL ON public.hatchery_batches TO service_role;
ALTER TABLE public.hatchery_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY hb_view ON public.hatchery_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY hb_manage ON public.hatchery_batches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'hatchery_manager'))
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'hatchery_manager'));

CREATE TABLE public.hatchery_batch_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.hatchery_batches(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('capital_ostrich','external_client')),
  client_id uuid REFERENCES public.hatch_customers(id),
  client_name_snapshot text,
  source text NOT NULL CHECK (source IN ('mother_farm','external')),
  eggs_in integer NOT NULL CHECK (eggs_in >= 0),
  infertile_eggs integer,
  infertile_edible integer,
  infertile_inedible integer,
  fertile_eggs integer,
  candling_notes text,
  candling_recorded_at timestamptz,
  candling_by uuid,
  hatcher_machine_no text,
  transferred_to_hatcher_at timestamptz,
  transferred_to_hatcher_by uuid,
  transferred_count integer,
  chicks_hatched integer,
  completed_unhatched integer,
  hatcher_out_at timestamptz,
  hatcher_out_by uuid,
  brooding_in_at timestamptz,
  brooding_out_at timestamptz,
  brooding_days integer,
  invoice_id uuid,
  cancelled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.hatchery_batch_lots TO authenticated;
GRANT ALL ON public.hatchery_batch_lots TO service_role;
ALTER TABLE public.hatchery_batch_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY hbl_view ON public.hatchery_batch_lots FOR SELECT TO authenticated USING (true);
CREATE POLICY hbl_manage ON public.hatchery_batch_lots FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'hatchery_manager'))
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'hatchery_manager'));

CREATE TABLE public.hatchery_batch_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.hatchery_batches(id) ON DELETE CASCADE,
  lot_id uuid REFERENCES public.hatchery_batch_lots(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created','candling','transferred_to_hatcher','hatched','moved_to_brooding','delivered','cancelled')),
  payload jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.hatchery_batch_movements TO authenticated;
GRANT ALL ON public.hatchery_batch_movements TO service_role;
ALTER TABLE public.hatchery_batch_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY hbm_view ON public.hatchery_batch_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY hbm_insert ON public.hatchery_batch_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'hatchery_manager'));

CREATE TABLE public.hatchery_client_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text UNIQUE NOT NULL DEFAULT ('HINV-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text,1,4)),
  client_id uuid REFERENCES public.hatch_customers(id),
  client_name_snapshot text,
  batch_id uuid REFERENCES public.hatchery_batches(id),
  lot_id uuid UNIQUE REFERENCES public.hatchery_batch_lots(id),
  eggs_in integer NOT NULL DEFAULT 0,
  infertile_count integer NOT NULL DEFAULT 0,
  infertile_unit_price numeric NOT NULL DEFAULT 0,
  infertile_amount numeric NOT NULL DEFAULT 0,
  chicks_count integer NOT NULL DEFAULT 0,
  chick_unit_price numeric NOT NULL DEFAULT 0,
  chicks_amount numeric NOT NULL DEFAULT 0,
  completed_unhatched_count integer NOT NULL DEFAULT 0,
  completed_unhatched_unit_price numeric NOT NULL DEFAULT 0,
  completed_unhatched_amount numeric NOT NULL DEFAULT 0,
  brooding_chicks_count integer NOT NULL DEFAULT 0,
  brooding_days integer NOT NULL DEFAULT 0,
  brooding_daily_price numeric NOT NULL DEFAULT 0,
  brooding_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  remaining_amount numeric GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid')),
  pricing_settings_version integer,
  notes text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.hatchery_client_invoices TO authenticated;
GRANT ALL ON public.hatchery_client_invoices TO service_role;
ALTER TABLE public.hatchery_client_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY hci_view ON public.hatchery_client_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY hci_manage ON public.hatchery_client_invoices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'accountant'))
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'accountant'));

CREATE TABLE public.hatchery_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.hatchery_client_invoices(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  method text,
  notes text,
  received_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.hatchery_invoice_payments TO authenticated;
GRANT ALL ON public.hatchery_invoice_payments TO service_role;
ALTER TABLE public.hatchery_invoice_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY hip_view ON public.hatchery_invoice_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY hip_manage ON public.hatchery_invoice_payments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'accountant'))
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'accountant'));

CREATE OR REPLACE FUNCTION public.hatchery_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER trg_hb_updated BEFORE UPDATE ON public.hatchery_batches FOR EACH ROW EXECUTE FUNCTION public.hatchery_set_updated_at();
CREATE TRIGGER trg_hbl_updated BEFORE UPDATE ON public.hatchery_batch_lots FOR EACH ROW EXECUTE FUNCTION public.hatchery_set_updated_at();
CREATE TRIGGER trg_hci_updated BEFORE UPDATE ON public.hatchery_client_invoices FOR EACH ROW EXECUTE FUNCTION public.hatchery_set_updated_at();

CREATE OR REPLACE FUNCTION public.hatchery_recalc_invoice_payments() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_paid numeric; v_total numeric; v_inv uuid;
BEGIN
  v_inv := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.hatchery_invoice_payments WHERE invoice_id = v_inv;
  SELECT total_amount INTO v_total FROM public.hatchery_client_invoices WHERE id = v_inv;
  UPDATE public.hatchery_client_invoices SET
    paid_amount = v_paid,
    payment_status = CASE WHEN v_paid <= 0 THEN 'unpaid' WHEN v_paid >= COALESCE(v_total,0) THEN 'paid' ELSE 'partial' END
  WHERE id = v_inv;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_hip_recalc AFTER INSERT OR DELETE OR UPDATE ON public.hatchery_invoice_payments FOR EACH ROW EXECUTE FUNCTION public.hatchery_recalc_invoice_payments();

CREATE OR REPLACE FUNCTION public.compute_hatchery_invoice(_lot_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  s public.hatchery_pricing_settings%ROWTYPE;
  l public.hatchery_batch_lots%ROWTYPE;
  v_infertile int; v_chicks int; v_unhatched int; v_brood_days int; v_brood_count int;
  v_inf_amt numeric; v_ch_amt numeric; v_un_amt numeric; v_br_amt numeric; v_total numeric;
  v_invoice_id uuid;
BEGIN
  SELECT * INTO l FROM public.hatchery_batch_lots WHERE id = _lot_id;
  IF NOT FOUND OR l.owner_type <> 'external_client' THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.hatchery_pricing_settings ORDER BY updated_at DESC LIMIT 1;

  v_infertile := COALESCE(l.infertile_eggs,0);
  v_chicks := COALESCE(l.chicks_hatched,0);
  v_unhatched := COALESCE(l.completed_unhatched,0);
  v_brood_count := COALESCE(l.chicks_hatched,0);
  v_brood_days := COALESCE(l.brooding_days,
    CASE WHEN l.brooding_out_at IS NOT NULL AND l.brooding_in_at IS NOT NULL
      THEN GREATEST(0, (l.brooding_out_at::date - l.brooding_in_at::date)) ELSE 0 END);

  v_inf_amt := v_infertile * s.infertile_egg_price;
  v_ch_amt := v_chicks * s.chick_price;
  v_un_amt := v_unhatched * s.completed_unhatched_price;
  v_br_amt := v_brood_count * v_brood_days * s.daily_brooding_price;
  v_total := v_inf_amt + v_ch_amt + v_un_amt + v_br_amt;

  IF l.invoice_id IS NULL THEN
    INSERT INTO public.hatchery_client_invoices (
      client_id, client_name_snapshot, batch_id, lot_id, eggs_in,
      infertile_count, infertile_unit_price, infertile_amount,
      chicks_count, chick_unit_price, chicks_amount,
      completed_unhatched_count, completed_unhatched_unit_price, completed_unhatched_amount,
      brooding_chicks_count, brooding_days, brooding_daily_price, brooding_amount,
      total_amount, pricing_settings_version, issued_by
    ) VALUES (
      l.client_id, l.client_name_snapshot, l.batch_id, l.id, l.eggs_in,
      v_infertile, s.infertile_egg_price, v_inf_amt,
      v_chicks, s.chick_price, v_ch_amt,
      v_unhatched, s.completed_unhatched_price, v_un_amt,
      v_brood_count, v_brood_days, s.daily_brooding_price, v_br_amt,
      v_total, s.version, auth.uid()
    ) RETURNING id INTO v_invoice_id;
    UPDATE public.hatchery_batch_lots SET invoice_id = v_invoice_id WHERE id = l.id;
  ELSE
    v_invoice_id := l.invoice_id;
    UPDATE public.hatchery_client_invoices SET
      eggs_in = l.eggs_in,
      infertile_count = v_infertile, infertile_unit_price = s.infertile_egg_price, infertile_amount = v_inf_amt,
      chicks_count = v_chicks, chick_unit_price = s.chick_price, chicks_amount = v_ch_amt,
      completed_unhatched_count = v_unhatched, completed_unhatched_unit_price = s.completed_unhatched_price, completed_unhatched_amount = v_un_amt,
      brooding_chicks_count = v_brood_count, brooding_days = v_brood_days, brooding_daily_price = s.daily_brooding_price, brooding_amount = v_br_amt,
      total_amount = v_total
    WHERE id = v_invoice_id;
  END IF;

  UPDATE public.hatchery_client_invoices SET
    payment_status = CASE WHEN paid_amount <= 0 THEN 'unpaid' WHEN paid_amount >= total_amount THEN 'paid' ELSE 'partial' END
  WHERE id = v_invoice_id;
  RETURN v_invoice_id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_hatchery_batch(_batch_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.hatchery_batches SET status='cancelled', cancel_reason=_reason WHERE id=_batch_id;
  UPDATE public.hatchery_batch_lots SET cancelled=true WHERE batch_id=_batch_id;
  INSERT INTO public.hatchery_batch_movements (batch_id, event_type, payload, created_by)
    VALUES (_batch_id, 'cancelled', jsonb_build_object('reason', _reason), auth.uid());
END $$;

CREATE OR REPLACE VIEW public.v_hatchery_batches_full AS
SELECT b.*,
  s.candling_day, s.transfer_to_hatcher_day,
  (b.entry_date + s.candling_day)::date AS candle_due_date,
  (b.entry_date + s.transfer_to_hatcher_day)::date AS hatcher_due_date,
  COALESCE((SELECT SUM(eggs_in) FROM public.hatchery_batch_lots l WHERE l.batch_id=b.id AND NOT l.cancelled),0) AS total_eggs_in,
  COALESCE((SELECT SUM(eggs_in) FROM public.hatchery_batch_lots l WHERE l.batch_id=b.id AND l.owner_type='capital_ostrich' AND NOT l.cancelled),0) AS internal_eggs,
  COALESCE((SELECT SUM(eggs_in) FROM public.hatchery_batch_lots l WHERE l.batch_id=b.id AND l.owner_type='external_client' AND NOT l.cancelled),0) AS external_eggs,
  COALESCE((SELECT SUM(chicks_hatched) FROM public.hatchery_batch_lots l WHERE l.batch_id=b.id AND NOT l.cancelled),0) AS total_chicks
FROM public.hatchery_batches b
CROSS JOIN LATERAL (SELECT * FROM public.hatchery_pricing_settings ORDER BY updated_at DESC LIMIT 1) s;
GRANT SELECT ON public.v_hatchery_batches_full TO authenticated;

CREATE OR REPLACE VIEW public.v_hatchery_client_balances AS
SELECT c.id AS client_id, c.name AS client_name,
  COUNT(i.id) AS invoices_count,
  COALESCE(SUM(i.total_amount),0) AS total_amount,
  COALESCE(SUM(i.paid_amount),0) AS paid_amount,
  COALESCE(SUM(i.remaining_amount),0) AS remaining_amount
FROM public.hatch_customers c
LEFT JOIN public.hatchery_client_invoices i ON i.client_id = c.id
GROUP BY c.id, c.name;
GRANT SELECT ON public.v_hatchery_client_balances TO authenticated;

CREATE OR REPLACE VIEW public.v_hatchery_dashboard_kpis AS
WITH s AS (SELECT * FROM public.hatchery_pricing_settings ORDER BY updated_at DESC LIMIT 1),
lots AS (
  SELECT l.*, b.status AS batch_status, b.entry_date
  FROM public.hatchery_batch_lots l
  JOIN public.hatchery_batches b ON b.id=l.batch_id
  WHERE NOT l.cancelled AND b.status<>'cancelled'
)
SELECT
  (SELECT COALESCE(SUM(eggs_in),0) FROM lots WHERE batch_status IN ('incubating','candled')) AS eggs_in_incubators,
  (SELECT COALESCE(SUM(eggs_in),0) FROM lots WHERE owner_type='capital_ostrich' AND batch_status IN ('incubating','candled')) AS internal_eggs,
  (SELECT COALESCE(SUM(eggs_in),0) FROM lots WHERE owner_type='external_client' AND batch_status IN ('incubating','candled')) AS external_eggs,
  (SELECT COUNT(DISTINCT l.batch_id) FROM lots l, s WHERE l.batch_status='incubating' AND l.candling_recorded_at IS NULL AND (l.entry_date + s.candling_day) <= CURRENT_DATE) AS batches_awaiting_candling,
  (SELECT COUNT(DISTINCT l.batch_id) FROM lots l, s WHERE l.batch_status IN ('incubating','candled') AND l.transferred_to_hatcher_at IS NULL AND (l.entry_date + s.transfer_to_hatcher_day) <= CURRENT_DATE) AS batches_awaiting_hatcher,
  (SELECT COALESCE(SUM(transferred_count),0) FROM lots WHERE batch_status='in_hatcher') AS in_hatcher,
  (SELECT COALESCE(SUM(chicks_hatched),0) FROM lots WHERE brooding_in_at IS NOT NULL AND brooding_out_at IS NULL) AS in_brooding,
  (SELECT COALESCE(SUM(chicks_hatched),0) FROM lots WHERE hatcher_out_at >= date_trunc('month', now())) AS chicks_this_month,
  (SELECT CASE WHEN SUM(fertile_eggs)>0 THEN ROUND(SUM(chicks_hatched)::numeric/SUM(fertile_eggs)*100,1) ELSE 0 END FROM lots WHERE fertile_eggs IS NOT NULL) AS hatch_rate_pct,
  (SELECT COALESCE(SUM(total_amount),0) FROM public.hatchery_client_invoices) AS invoices_total,
  (SELECT COALESCE(SUM(paid_amount),0) FROM public.hatchery_client_invoices) AS invoices_paid,
  (SELECT COALESCE(SUM(remaining_amount),0) FROM public.hatchery_client_invoices) AS invoices_remaining;
GRANT SELECT ON public.v_hatchery_dashboard_kpis TO authenticated;
