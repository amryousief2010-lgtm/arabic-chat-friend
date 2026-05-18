
-- Add new columns
ALTER TABLE public.farm_to_hatchery_shipments
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS suggested_batch_id uuid REFERENCES public.hatch_batches(id) ON DELETE SET NULL;

-- Smart suggestion function: returns latest open hatch_batch on/before the production date
CREATE OR REPLACE FUNCTION public.suggest_hatch_batch_for_shipment(p_shipment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_batch uuid;
BEGIN
  SELECT production_date INTO v_date
  FROM public.farm_to_hatchery_shipments WHERE id = p_shipment_id;
  IF v_date IS NULL THEN RETURN NULL; END IF;

  -- Prefer same date
  SELECT id INTO v_batch FROM public.hatch_batches
  WHERE receive_date = v_date AND COALESCE(status,'') <> 'completed'
  ORDER BY created_at DESC LIMIT 1;
  IF v_batch IS NOT NULL THEN RETURN v_batch; END IF;

  -- Else most recent open within 7 days
  SELECT id INTO v_batch FROM public.hatch_batches
  WHERE receive_date BETWEEN (v_date - INTERVAL '7 days')::date AND v_date
    AND COALESCE(status,'') <> 'completed'
  ORDER BY receive_date DESC, created_at DESC LIMIT 1;
  RETURN v_batch;
END;
$$;

-- Trigger: notify farm side when shipment is confirmed / rejected
CREATE OR REPLACE FUNCTION public.notify_farm_shipment_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receiver text;
BEGIN
  IF COALESCE(OLD.status,'') = COALESCE(NEW.status,'') THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('received','partial','rejected') THEN RETURN NEW; END IF;

  SELECT COALESCE(full_name, email) INTO v_receiver FROM public.profiles WHERE id = NEW.received_by;

  INSERT INTO public.notifications (title, description, type)
  VALUES (
    CASE NEW.status
      WHEN 'received' THEN 'تم استلام شحنة المزرعة'
      WHEN 'partial' THEN 'استلام جزئي لشحنة المزرعة'
      WHEN 'rejected' THEN 'رفض شحنة المزرعة'
    END,
    'أسرة ' || COALESCE(NEW.family_number,'-') ||
    ' بتاريخ ' || NEW.production_date ||
    ' — مرسل: ' || NEW.egg_count ||
    CASE WHEN NEW.status = 'rejected'
         THEN ' — مرفوضة' || CASE WHEN NEW.rejection_reason IS NOT NULL THEN ' (' || NEW.rejection_reason || ')' ELSE '' END
         ELSE ' / مستلم: ' || COALESCE(NEW.received_egg_count,0) || ' / تالف: ' || COALESCE(NEW.damaged_count,0)
    END ||
    CASE WHEN v_receiver IS NOT NULL THEN ' — بواسطة ' || v_receiver ELSE '' END,
    'farm_shipment_receipt'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_farm_shipment_receipt ON public.farm_to_hatchery_shipments;
CREATE TRIGGER trg_notify_farm_shipment_receipt
AFTER UPDATE ON public.farm_to_hatchery_shipments
FOR EACH ROW EXECUTE FUNCTION public.notify_farm_shipment_receipt();
