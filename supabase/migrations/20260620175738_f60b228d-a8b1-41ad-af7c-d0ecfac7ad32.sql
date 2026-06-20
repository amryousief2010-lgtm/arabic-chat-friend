
-- 1) Add price setting (default 100 EGP per hatch mortality unit)
ALTER TABLE public.hatchery_pricing_settings
  ADD COLUMN IF NOT EXISTS hatch_mortality_price numeric NOT NULL DEFAULT 100;

-- 2) Add invoice columns
ALTER TABLE public.hatchery_client_invoices
  ADD COLUMN IF NOT EXISTS hatch_mortality_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hatch_mortality_unit_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hatch_mortality_amount numeric NOT NULL DEFAULT 0;

-- 3) Rewrite compute_hatchery_invoice to include hatch mortality
CREATE OR REPLACE FUNCTION public.compute_hatchery_invoice(_lot_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.hatchery_pricing_settings%ROWTYPE;
  l public.hatchery_batch_lots%ROWTYPE;
  v_infertile int; v_chicks int; v_unhatched int; v_brood_days int; v_brood_count int;
  v_hatch_mort int; v_transferred int;
  v_inf_amt numeric; v_ch_amt numeric; v_un_amt numeric; v_br_amt numeric;
  v_hm_amt numeric; v_total numeric;
  v_invoice_id uuid;
  v_start_date date;
  v_end_date date;
BEGIN
  SELECT * INTO l FROM public.hatchery_batch_lots WHERE id = _lot_id;
  IF NOT FOUND OR l.owner_type <> 'external_client' THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.hatchery_pricing_settings ORDER BY updated_at DESC LIMIT 1;

  v_infertile := COALESCE(l.infertile_eggs,0);
  v_chicks := COALESCE(l.chicks_hatched,0);
  v_unhatched := COALESCE(l.completed_unhatched,0);
  v_brood_count := COALESCE(l.chicks_hatched,0);

  -- Determine the count that entered the hatcher (fallbacks for older lots)
  v_transferred := COALESCE(
    NULLIF(l.transferred_count, 0),
    NULLIF(l.fertile_eggs, 0),
    GREATEST(COALESCE(l.eggs_in,0) - v_infertile, 0)
  );
  -- Hatch mortality = transferred − hatched − completed_unhatched (never < 0)
  v_hatch_mort := GREATEST(0, COALESCE(v_transferred,0) - v_chicks - v_unhatched);

  v_start_date := COALESCE(l.hatcher_out_at::date, l.brooding_in_at::date);
  v_end_date := COALESCE(l.brooding_out_at::date, CURRENT_DATE);
  IF v_start_date IS NOT NULL AND v_chicks > 0 THEN
    v_brood_days := GREATEST(1, (v_end_date - v_start_date) + 1);
  ELSE
    v_brood_days := 0;
  END IF;

  v_inf_amt := v_infertile * s.infertile_egg_price;
  v_ch_amt := v_chicks * s.chick_price;
  v_un_amt := v_unhatched * s.completed_unhatched_price;
  v_br_amt := v_brood_count * v_brood_days * s.daily_brooding_price;
  v_hm_amt := v_hatch_mort * COALESCE(s.hatch_mortality_price, 100);
  v_total := v_inf_amt + v_ch_amt + v_un_amt + v_br_amt + v_hm_amt;

  IF l.invoice_id IS NULL THEN
    INSERT INTO public.hatchery_client_invoices (
      client_id, client_name_snapshot, batch_id, lot_id, eggs_in,
      infertile_count, infertile_unit_price, infertile_amount,
      chicks_count, chick_unit_price, chicks_amount,
      completed_unhatched_count, completed_unhatched_unit_price, completed_unhatched_amount,
      brooding_chicks_count, brooding_days, brooding_daily_price, brooding_amount,
      hatch_mortality_count, hatch_mortality_unit_price, hatch_mortality_amount,
      total_amount, pricing_settings_version, issued_by
    ) VALUES (
      l.client_id, l.client_name_snapshot, l.batch_id, l.id, l.eggs_in,
      v_infertile, s.infertile_egg_price, v_inf_amt,
      v_chicks, s.chick_price, v_ch_amt,
      v_unhatched, s.completed_unhatched_price, v_un_amt,
      v_brood_count, v_brood_days, s.daily_brooding_price, v_br_amt,
      v_hatch_mort, COALESCE(s.hatch_mortality_price,100), v_hm_amt,
      v_total, s.version, auth.uid()
    ) RETURNING id INTO v_invoice_id;
    UPDATE public.hatchery_batch_lots SET invoice_id = v_invoice_id, brooding_days = v_brood_days WHERE id = l.id;
  ELSE
    v_invoice_id := l.invoice_id;
    UPDATE public.hatchery_client_invoices SET
      eggs_in = l.eggs_in,
      infertile_count = v_infertile, infertile_unit_price = s.infertile_egg_price, infertile_amount = v_inf_amt,
      chicks_count = v_chicks, chick_unit_price = s.chick_price, chicks_amount = v_ch_amt,
      completed_unhatched_count = v_unhatched,
      completed_unhatched_unit_price = s.completed_unhatched_price,
      completed_unhatched_amount = v_un_amt,
      brooding_chicks_count = v_brood_count, brooding_days = v_brood_days,
      brooding_daily_price = s.daily_brooding_price, brooding_amount = v_br_amt,
      hatch_mortality_count = v_hatch_mort,
      hatch_mortality_unit_price = COALESCE(s.hatch_mortality_price,100),
      hatch_mortality_amount = v_hm_amt,
      total_amount = v_total,
      pricing_settings_version = s.version,
      updated_at = now()
    WHERE id = v_invoice_id;
    UPDATE public.hatchery_batch_lots SET brooding_days = v_brood_days WHERE id = l.id;
  END IF;

  RETURN v_invoice_id;
END;
$function$;

-- 4) Backfill all existing external client invoices (UPDATE branch only, won't touch payments/treasury)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT lot_id FROM public.hatchery_client_invoices WHERE lot_id IS NOT NULL
  LOOP
    PERFORM public.compute_hatchery_invoice(r.lot_id);
  END LOOP;
END $$;
