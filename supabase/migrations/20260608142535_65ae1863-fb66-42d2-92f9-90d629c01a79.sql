
CREATE OR REPLACE FUNCTION public.trg_lab_ledger_after_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid UUID;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  cid := COALESCE(NEW.customer_id, OLD.customer_id);
  PERFORM public.lab_ledger_recompute_balance(cid);
  INSERT INTO public.lab_customer_ledger_audit(ledger_id, customer_id, action, old_data, new_data, changed_by)
  VALUES (COALESCE(NEW.id, OLD.id), cid, TG_OP,
          CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
          CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          auth.uid());
  RETURN NULL;
END; $$;

CREATE TRIGGER trg_lab_ledger_aft
AFTER INSERT OR UPDATE OR DELETE ON public.lab_customer_ledger
FOR EACH ROW EXECUTE FUNCTION public.trg_lab_ledger_after_change();

CREATE OR REPLACE FUNCTION public.trg_hatch_batch_to_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_infertile INT; v_c2 INT; v_chicks INT; v_bdays INT; v_bchicks INT;
  v_subtotal NUMERIC; v_existing UUID; v_disc NUMERIC;
BEGIN
  IF NEW.is_test = true OR NEW.customer_id IS NULL OR NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;
  v_infertile := COALESCE(NEW.candle1_infertile,0);
  v_c2 := COALESCE(NEW.candle2_dead,0);
  v_chicks := COALESCE(NEW.hatched_chicks,0);
  v_bdays := COALESCE(NEW.brooding_days,0);
  v_bchicks := CASE WHEN v_bdays>0 THEN v_chicks ELSE 0 END;
  v_subtotal := v_infertile*50 + v_c2*100 + v_chicks*150 + v_bchicks*v_bdays*10;

  SELECT id, COALESCE(discount,0) INTO v_existing, v_disc FROM public.lab_customer_ledger
   WHERE source_type='hatch_batch' AND source_id=NEW.id AND customer_id=NEW.customer_id;

  IF v_existing IS NULL THEN
    INSERT INTO public.lab_customer_ledger(
      customer_id, entry_date, entry_type, source_type, source_id,
      batch_number, operational_batch_no,
      infertile_eggs, candle2_dead, chicks, brooding_chicks, brooding_days,
      subtotal, debit, description
    ) VALUES (
      NEW.customer_id, COALESCE(NEW.exit_date, NEW.entry_date, CURRENT_DATE),
      'batch_charge','hatch_batch', NEW.id,
      NEW.batch_number, NEW.operational_batch_no,
      v_infertile, v_c2, v_chicks, v_bchicks, v_bdays,
      v_subtotal, v_subtotal,
      'مستحقات دفعة تفريخ رقم '||COALESCE(NEW.operational_batch_no::text, NEW.batch_number)
    );
  ELSE
    UPDATE public.lab_customer_ledger SET
      entry_date=COALESCE(NEW.exit_date, NEW.entry_date, entry_date),
      batch_number=NEW.batch_number, operational_batch_no=NEW.operational_batch_no,
      infertile_eggs=v_infertile, candle2_dead=v_c2, chicks=v_chicks,
      brooding_chicks=v_bchicks, brooding_days=v_bdays,
      subtotal=v_subtotal, debit=v_subtotal - COALESCE(v_disc,0), updated_at=now()
    WHERE id=v_existing;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_hatch_batch_ledger_aiu
AFTER INSERT OR UPDATE ON public.hatch_batches
FOR EACH ROW EXECUTE FUNCTION public.trg_hatch_batch_to_ledger();

CREATE OR REPLACE FUNCTION public.trg_lab_treasury_to_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_cust UUID;
BEGIN
  IF TG_OP='DELETE' THEN
    DELETE FROM public.lab_customer_ledger
      WHERE source_type='lab_treasury_movement' AND source_id=OLD.id;
    RETURN OLD;
  END IF;
  IF NEW.customer_name IS NULL OR NEW.movement_type::text <> 'income' THEN
    DELETE FROM public.lab_customer_ledger
      WHERE source_type='lab_treasury_movement' AND source_id=NEW.id;
    RETURN NEW;
  END IF;
  SELECT id INTO v_cust FROM public.hatch_customers
   WHERE lower(trim(name))=lower(trim(NEW.customer_name)) AND is_active=true LIMIT 1;
  IF v_cust IS NULL THEN RETURN NEW; END IF;

  IF NEW.status::text='approved' THEN
    INSERT INTO public.lab_customer_ledger(
      customer_id, entry_date, entry_type, source_type, source_id,
      batch_number, credit, payment_method, description, notes
    ) VALUES (
      v_cust, NEW.movement_date, 'collection','lab_treasury_movement', NEW.id,
      NEW.batch_number, NEW.amount, NEW.payment_method::text,
      COALESCE(NEW.description,'تحصيل من خزنة المعمل'), NEW.notes
    )
    ON CONFLICT (source_type, source_id, customer_id)
    DO UPDATE SET credit=EXCLUDED.credit, entry_date=EXCLUDED.entry_date,
                  payment_method=EXCLUDED.payment_method, description=EXCLUDED.description,
                  notes=EXCLUDED.notes, updated_at=now();
  ELSE
    DELETE FROM public.lab_customer_ledger
      WHERE source_type='lab_treasury_movement' AND source_id=NEW.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_lab_treasury_ledger_aiud
AFTER INSERT OR UPDATE OR DELETE ON public.lab_treasury_movements
FOR EACH ROW EXECUTE FUNCTION public.trg_lab_treasury_to_ledger();

INSERT INTO public.lab_customer_ledger(
  customer_id, entry_date, entry_type, source_type, source_id,
  batch_number, operational_batch_no,
  infertile_eggs, candle2_dead, chicks, brooding_chicks, brooding_days,
  subtotal, debit, description
)
SELECT
  b.customer_id,
  COALESCE(b.exit_date, b.entry_date, CURRENT_DATE),
  'batch_charge','hatch_batch', b.id,
  b.batch_number, b.operational_batch_no,
  COALESCE(b.candle1_infertile,0), COALESCE(b.candle2_dead,0),
  COALESCE(b.hatched_chicks,0),
  CASE WHEN COALESCE(b.brooding_days,0)>0 THEN COALESCE(b.hatched_chicks,0) ELSE 0 END,
  COALESCE(b.brooding_days,0),
  COALESCE(b.candle1_infertile,0)*50 + COALESCE(b.candle2_dead,0)*100
    + COALESCE(b.hatched_chicks,0)*150
    + (CASE WHEN COALESCE(b.brooding_days,0)>0 THEN COALESCE(b.hatched_chicks,0) ELSE 0 END)*COALESCE(b.brooding_days,0)*10,
  COALESCE(b.candle1_infertile,0)*50 + COALESCE(b.candle2_dead,0)*100
    + COALESCE(b.hatched_chicks,0)*150
    + (CASE WHEN COALESCE(b.brooding_days,0)>0 THEN COALESCE(b.hatched_chicks,0) ELSE 0 END)*COALESCE(b.brooding_days,0)*10,
  'مستحقات دفعة تفريخ رقم '||COALESCE(b.operational_batch_no::text, b.batch_number)
FROM public.hatch_batches b
WHERE b.is_test=false AND b.customer_id IS NOT NULL AND b.status='completed'
ON CONFLICT (source_type, source_id, customer_id) DO NOTHING;

INSERT INTO public.lab_customer_ledger(
  customer_id, entry_date, entry_type, source_type, source_id,
  batch_number, credit, payment_method, description, notes
)
SELECT
  c.id, m.movement_date, 'collection','lab_treasury_movement', m.id,
  m.batch_number, m.amount, m.payment_method::text,
  COALESCE(m.description,'تحصيل من خزنة المعمل'), m.notes
FROM public.lab_treasury_movements m
JOIN public.hatch_customers c ON lower(trim(c.name))=lower(trim(m.customer_name)) AND c.is_active=true
WHERE m.movement_type::text='income' AND m.status::text='approved' AND m.customer_name IS NOT NULL
ON CONFLICT (source_type, source_id, customer_id) DO NOTHING;

DO $$
DECLARE r RECORD; v_bal NUMERIC;
BEGIN
  FOR r IN SELECT DISTINCT customer_id FROM public.lab_customer_ledger
           WHERE operational_batch_no <= 15 AND entry_type='batch_charge' LOOP
    SELECT COALESCE(SUM(debit),0)-COALESCE(SUM(credit),0) INTO v_bal
      FROM public.lab_customer_ledger WHERE customer_id=r.customer_id;
    IF v_bal > 0 THEN
      INSERT INTO public.lab_customer_ledger(
        customer_id, entry_date, entry_type, source_type, source_id,
        credit, payment_method, description, notes
      ) VALUES (
        r.customer_id, CURRENT_DATE, 'historical_closeout','historical_closeout', gen_random_uuid(),
        v_bal, 'historical_settlement',
        'تسوية تاريخية للدفعات حتى رقم 15',
        'تم تحصيل المستحقات حتى الدفعة 15');
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT customer_id FROM public.lab_customer_ledger LOOP
    PERFORM public.lab_ledger_recompute_balance(r.customer_id);
  END LOOP;
END $$;
