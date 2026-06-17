
-- 1) Table
CREATE TABLE public.slaughter_batch_live_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slaughter_batch_id uuid NOT NULL REFERENCES public.slaughter_batches(id) ON DELETE CASCADE,
  live_receipt_id uuid NOT NULL REFERENCES public.slaughter_live_receipts(id) ON DELETE RESTRICT,
  birds_count int NOT NULL CHECK (birds_count > 0),
  cost_per_bird_snapshot numeric(14,4) NOT NULL DEFAULT 0,
  total_birds_cost numeric(14,4) NOT NULL DEFAULT 0,
  notes text,
  reference_id text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slaughter_batch_id, live_receipt_id)
);

CREATE INDEX idx_sbls_batch ON public.slaughter_batch_live_sources(slaughter_batch_id);
CREATE INDEX idx_sbls_receipt ON public.slaughter_batch_live_sources(live_receipt_id);

-- 2) GRANTs
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slaughter_batch_live_sources TO authenticated;
GRANT ALL ON public.slaughter_batch_live_sources TO service_role;

-- 3) RLS
ALTER TABLE public.slaughter_batch_live_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view slaughter batch sources"
  ON public.slaughter_batch_live_sources FOR SELECT
  USING (true);

CREATE POLICY "manage slaughter batch sources"
  ON public.slaughter_batch_live_sources FOR ALL
  USING (
    has_any_role(auth.uid(), ARRAY[
      'general_manager'::app_role,
      'executive_manager'::app_role,
      'slaughterhouse_manager'::app_role,
      'production_manager'::app_role,
      'agouza_warehouse_keeper'::app_role
    ])
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY[
      'general_manager'::app_role,
      'executive_manager'::app_role,
      'slaughterhouse_manager'::app_role,
      'production_manager'::app_role,
      'agouza_warehouse_keeper'::app_role
    ])
  );

-- 4) updated_at trigger
CREATE TRIGGER trg_sbls_updated_at
  BEFORE UPDATE ON public.slaughter_batch_live_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Validation + auto-deduct trigger
CREATE OR REPLACE FUNCTION public.sbls_validate_and_deduct()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available int;
  v_cost numeric;
  v_receipt_no text;
BEGIN
  SELECT current_alive_count, cost_per_bird_current, receipt_number
    INTO v_available, v_cost, v_receipt_no
    FROM public.slaughter_live_receipts
    WHERE id = NEW.live_receipt_id
    FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'دفعة النعام المصدر غير موجودة';
  END IF;

  IF NEW.birds_count > v_available THEN
    RAISE EXCEPTION 'العدد المطلوب دبحه (%) أكبر من المتاح في الدفعة % (المتاح: %)',
      NEW.birds_count, v_receipt_no, v_available;
  END IF;

  -- Snapshot cost if zero / not provided
  IF NEW.cost_per_bird_snapshot IS NULL OR NEW.cost_per_bird_snapshot = 0 THEN
    NEW.cost_per_bird_snapshot := COALESCE(v_cost, 0);
  END IF;
  NEW.total_birds_cost := ROUND(NEW.cost_per_bird_snapshot * NEW.birds_count, 4);

  IF NEW.reference_id IS NULL OR NEW.reference_id = '' THEN
    NEW.reference_id := 'slaughter_source_' || NEW.slaughter_batch_id::text || '_' || NEW.live_receipt_id::text;
  END IF;

  -- Deduct from source receipt
  UPDATE public.slaughter_live_receipts
    SET current_alive_count = current_alive_count - NEW.birds_count
    WHERE id = NEW.live_receipt_id;

  -- Audit log
  INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, old_value, new_value, notes)
  VALUES (
    'slaughter_source_added',
    'slaughter_live_receipts',
    NEW.live_receipt_id,
    NEW.slaughter_batch_id,
    jsonb_build_object('available_before', v_available, 'cost_per_bird', v_cost),
    jsonb_build_object('birds_taken', NEW.birds_count, 'cost_snapshot', NEW.cost_per_bird_snapshot, 'total_cost', NEW.total_birds_cost),
    'سحب نعام للدبح من دفعة ' || COALESCE(v_receipt_no,'?') || ' — reference_id=' || NEW.reference_id
  );

  RETURN NEW;
END $$;

CREATE TRIGGER trg_sbls_before_insert
  BEFORE INSERT ON public.slaughter_batch_live_sources
  FOR EACH ROW EXECUTE FUNCTION public.sbls_validate_and_deduct();

-- 6) Restore stock on delete
CREATE OR REPLACE FUNCTION public.sbls_restore_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.slaughter_live_receipts
    SET current_alive_count = current_alive_count + OLD.birds_count
    WHERE id = OLD.live_receipt_id;

  INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, old_value, new_value, notes)
  VALUES (
    'slaughter_source_removed',
    'slaughter_live_receipts',
    OLD.live_receipt_id,
    OLD.slaughter_batch_id,
    jsonb_build_object('birds_taken', OLD.birds_count, 'cost_snapshot', OLD.cost_per_bird_snapshot),
    NULL,
    'إعادة نعام لدفعة المصدر بعد حذف مصدر الدبح — reference_id=' || COALESCE(OLD.reference_id,'')
  );

  RETURN OLD;
END $$;

CREATE TRIGGER trg_sbls_after_delete
  AFTER DELETE ON public.slaughter_batch_live_sources
  FOR EACH ROW EXECUTE FUNCTION public.sbls_restore_on_delete();
