-- 1) Link hatch_batches back to originating shipment to prevent duplicates
ALTER TABLE public.hatch_batches
  ADD COLUMN IF NOT EXISTS source_shipment_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hatch_batches_source_shipment
  ON public.hatch_batches(source_shipment_id) WHERE source_shipment_id IS NOT NULL;

-- 2) Link chick_movements back to originating batch so completion is idempotent
ALTER TABLE public.chick_movements
  ADD COLUMN IF NOT EXISTS source_batch_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chick_movements_source_batch
  ON public.chick_movements(source_batch_id) WHERE source_batch_id IS NOT NULL;

-- 3) Auto-create / link a hatch_batch when a shipment is received or partially received
CREATE OR REPLACE FUNCTION public.auto_link_shipment_to_hatch_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid;
  v_received int;
  v_damaged int;
  v_net int;
BEGIN
  -- Only act on receipts (full or partial) without a linked batch yet
  IF NEW.status NOT IN ('received','partial') THEN RETURN NEW; END IF;
  IF NEW.hatch_batch_id IS NOT NULL THEN RETURN NEW; END IF;

  -- Idempotency: if a batch already exists for this shipment, reuse it
  SELECT id INTO v_batch_id FROM public.hatch_batches
   WHERE source_shipment_id = NEW.id LIMIT 1;

  v_received := COALESCE(NEW.received_egg_count, NEW.egg_count, 0);
  v_damaged  := COALESCE(NEW.damaged_count, 0);
  v_net      := GREATEST(v_received - v_damaged, 0);

  IF v_batch_id IS NULL THEN
    INSERT INTO public.hatch_batches (
      batch_number, receive_date, received_eggs, net_eggs,
      status, source_shipment_id, notes, created_by
    ) VALUES (
      'BATCH-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,6),
      COALESCE(NEW.received_at::date, NEW.production_date, CURRENT_DATE),
      v_received,
      v_net,
      'pending',
      NEW.id,
      COALESCE('من شحنة المزرعة ' || NEW.family_number, NULL),
      NEW.received_by
    )
    RETURNING id INTO v_batch_id;
  END IF;

  -- Link back on the shipment (avoids recursion: trigger short-circuits when set)
  UPDATE public.farm_to_hatchery_shipments
     SET hatch_batch_id = v_batch_id
   WHERE id = NEW.id AND hatch_batch_id IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_shipment_to_hatch_batch ON public.farm_to_hatchery_shipments;
CREATE TRIGGER trg_auto_link_shipment_to_hatch_batch
AFTER INSERT OR UPDATE OF status, received_egg_count, damaged_count, hatch_batch_id
ON public.farm_to_hatchery_shipments
FOR EACH ROW
EXECUTE FUNCTION public.auto_link_shipment_to_hatch_batch();

-- 4) When a batch is marked completed with chicks, post a single chick_movement row
CREATE OR REPLACE FUNCTION public.sync_completed_batch_to_chicks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.hatched_chicks,0) <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.chick_movements (
    movement_date, source, incoming, outgoing, dead, sold, unit_price, notes, source_batch_id
  ) VALUES (
    COALESCE(NEW.exit_date, CURRENT_DATE),
    'دفعة معمل ' || NEW.batch_number,
    NEW.hatched_chicks,
    0, 0, 0, 0,
    'تم تسجيلها تلقائياً من دفعة المعمل ' || NEW.batch_number,
    NEW.id
  )
  ON CONFLICT (source_batch_id) DO UPDATE
    SET incoming = EXCLUDED.incoming,
        movement_date = EXCLUDED.movement_date,
        notes = EXCLUDED.notes;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_completed_batch_to_chicks ON public.hatch_batches;
CREATE TRIGGER trg_sync_completed_batch_to_chicks
AFTER INSERT OR UPDATE OF status, hatched_chicks, exit_date
ON public.hatch_batches
FOR EACH ROW
EXECUTE FUNCTION public.sync_completed_batch_to_chicks();

-- 5) Backfill: link existing received shipments that lost their batch link
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM public.farm_to_hatchery_shipments
     WHERE status IN ('received','partial') AND hatch_batch_id IS NULL
  LOOP
    UPDATE public.farm_to_hatchery_shipments
       SET status = status
     WHERE id = r.id; -- triggers the auto-link
  END LOOP;
END $$;