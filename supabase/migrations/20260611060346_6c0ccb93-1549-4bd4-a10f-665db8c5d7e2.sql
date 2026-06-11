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
  v_inf_amt numeric; v_ch_amt numeric; v_un_amt numeric; v_br_amt numeric; v_total numeric;
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

  -- Brooding period: from HATCH date (hatcher_out_at) to PICKUP date (brooding_out_at), inclusive (+1)
  -- If pickup not yet recorded, use today so projected fee is accurate.
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
    UPDATE public.hatchery_batch_lots SET invoice_id = v_invoice_id, brooding_days = v_brood_days WHERE id = l.id;
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
    UPDATE public.hatchery_batch_lots SET brooding_days = v_brood_days WHERE id = l.id;
  END IF;

  UPDATE public.hatchery_client_invoices SET
    payment_status = CASE WHEN paid_amount <= 0 THEN 'unpaid' WHEN paid_amount >= total_amount THEN 'paid' ELSE 'partial' END
  WHERE id = v_invoice_id;
  RETURN v_invoice_id;
END $function$;