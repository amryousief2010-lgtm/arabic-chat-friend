
-- 1. Settings table (singleton row)
CREATE TABLE IF NOT EXISTS public.slaughter_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  low_yield_threshold numeric NOT NULL DEFAULT 40,
  warning_yield_threshold numeric NOT NULL DEFAULT 45,
  notify_on_low_yield boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.slaughter_settings (low_yield_threshold, warning_yield_threshold, notify_on_low_yield)
SELECT 40, 45, true
WHERE NOT EXISTS (SELECT 1 FROM public.slaughter_settings);

ALTER TABLE public.slaughter_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "slaughter_settings_read" ON public.slaughter_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "slaughter_settings_write" ON public.slaughter_settings
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role,'quality_manager'::app_role,'slaughterhouse_manager'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role,'quality_manager'::app_role,'slaughterhouse_manager'::app_role]));

CREATE TRIGGER slaughter_settings_updated
  BEFORE UPDATE ON public.slaughter_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Audit log
CREATE TABLE IF NOT EXISTS public.slaughter_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,                  -- 'finalize_batch' | 'transfer_status_change' | ...
  target_type text NOT NULL,             -- 'batch' | 'transfer'
  target_id uuid,
  batch_id uuid,
  transfer_id uuid,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now(),
  old_value jsonb,
  new_value jsonb,
  notes text
);

ALTER TABLE public.slaughter_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "slaughter_audit_read" ON public.slaughter_audit_log
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role,'quality_manager'::app_role,'slaughterhouse_manager'::app_role,'financial_manager'::app_role,'accountant'::app_role]));

CREATE POLICY "slaughter_audit_insert" ON public.slaughter_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_slaughter_audit_batch ON public.slaughter_audit_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_slaughter_audit_transfer ON public.slaughter_audit_log(transfer_id);
CREATE INDEX IF NOT EXISTS idx_slaughter_audit_time ON public.slaughter_audit_log(performed_at DESC);

-- 3. Trigger: log transfer status changes
CREATE OR REPLACE FUNCTION public.log_slaughter_transfer_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status,'') <> COALESCE(NEW.status,'') THEN
    INSERT INTO public.slaughter_audit_log
      (action, target_type, target_id, batch_id, transfer_id, performed_by, old_value, new_value, notes)
    VALUES
      ('transfer_status_change', 'transfer', NEW.id, NEW.batch_id, NEW.id, auth.uid(),
       jsonb_build_object('status', OLD.status),
       jsonb_build_object('status', NEW.status, 'branch_id', NEW.branch_id, 'cut_name_ar', NEW.cut_name_ar, 'weight_kg', NEW.weight_kg),
       format('Transfer %s: %s -> %s', NEW.cut_name_ar, OLD.status, NEW.status));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_slaughter_transfer ON public.slaughter_branch_transfers;
CREATE TRIGGER trg_log_slaughter_transfer
  AFTER UPDATE ON public.slaughter_branch_transfers
  FOR EACH ROW EXECUTE FUNCTION public.log_slaughter_transfer_change();

-- 4. Update finalize_slaughter_batch to write audit entry
CREATE OR REPLACE FUNCTION public.finalize_slaughter_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch public.slaughter_batches%ROWTYPE;
  v_old   public.slaughter_batches%ROWTYPE;
  v_meat numeric := 0;
  v_total_purchase numeric := 0;
  v_cost_per_kg numeric := 0;
  v_transfers int := 0;
  v_yield_pct numeric := 0;
BEGIN
  SELECT * INTO v_batch FROM public.slaughter_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  v_old := v_batch;

  SELECT COALESCE(SUM(actual_weight_kg),0) INTO v_meat
  FROM public.slaughter_batch_outputs WHERE batch_id = p_batch_id;

  IF v_batch.live_receipt_id IS NOT NULL THEN
    SELECT COALESCE(total_cost,0) + COALESCE((
      SELECT SUM(feed_cost) FROM public.slaughter_live_birds WHERE receipt_id = v_batch.live_receipt_id
    ),0) INTO v_total_purchase
    FROM public.slaughter_live_receipts WHERE id = v_batch.live_receipt_id;
  END IF;

  IF v_meat > 0 THEN v_cost_per_kg := v_total_purchase / v_meat; END IF;
  IF v_batch.total_live_weight_kg > 0 THEN
    v_yield_pct := (v_meat / v_batch.total_live_weight_kg) * 100;
  END IF;

  UPDATE public.slaughter_batches
  SET total_meat_kg = v_meat,
      cost_per_kg_meat = v_cost_per_kg,
      actual_yield_pct = v_yield_pct,
      status = 'completed',
      end_time = COALESCE(end_time, CURRENT_TIME)
  WHERE id = p_batch_id;

  UPDATE public.slaughter_batch_outputs
  SET unit_cost = v_cost_per_kg,
      total_cost = actual_weight_kg * v_cost_per_kg
  WHERE batch_id = p_batch_id;

  INSERT INTO public.slaughter_branch_transfers (batch_id, output_id, branch_id, cut_name_ar, weight_kg, unit_price)
  SELECT o.batch_id, o.id, o.branch_id, o.cut_name_ar, o.actual_weight_kg, o.unit_price
  FROM public.slaughter_batch_outputs o
  WHERE o.batch_id = p_batch_id
    AND o.branch_id IS NOT NULL
    AND o.actual_weight_kg > 0
    AND NOT EXISTS (SELECT 1 FROM public.slaughter_branch_transfers t WHERE t.output_id = o.id);
  GET DIAGNOSTICS v_transfers = ROW_COUNT;

  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, old_value, new_value, notes)
  VALUES
    ('finalize_batch', 'batch', p_batch_id, p_batch_id, auth.uid(),
     jsonb_build_object(
       'status', v_old.status,
       'total_meat_kg', v_old.total_meat_kg,
       'actual_yield_pct', v_old.actual_yield_pct,
       'cost_per_kg_meat', v_old.cost_per_kg_meat
     ),
     jsonb_build_object(
       'status', 'completed',
       'total_meat_kg', v_meat,
       'actual_yield_pct', v_yield_pct,
       'cost_per_kg_meat', v_cost_per_kg,
       'total_purchase_cost', v_total_purchase,
       'transfers_created', v_transfers
     ),
     format('Finalized batch %s — yield %.1f%%, %s transfers', v_batch.batch_number, v_yield_pct, v_transfers));

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'total_meat_kg', v_meat,
    'total_purchase_cost', v_total_purchase,
    'cost_per_kg_meat', v_cost_per_kg,
    'actual_yield_pct', v_yield_pct,
    'transfers_created', v_transfers
  );
END;
$$;

-- 5. Make low-yield notification use settings threshold (warning)
CREATE OR REPLACE FUNCTION public.notify_low_yield()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing uuid;
  v_threshold numeric := 40;
  v_warn numeric := 45;
  v_enabled boolean := true;
BEGIN
  SELECT low_yield_threshold, warning_yield_threshold, notify_on_low_yield
    INTO v_threshold, v_warn, v_enabled
  FROM public.slaughter_settings LIMIT 1;

  IF NOT COALESCE(v_enabled, true) THEN RETURN NEW; END IF;

  IF NEW.status = 'completed' AND NEW.actual_yield_pct > 0 AND NEW.actual_yield_pct < v_warn THEN
    SELECT id INTO v_existing FROM public.notifications
      WHERE type = 'low_yield' AND description LIKE '%' || NEW.batch_number || '%' AND is_read = false LIMIT 1;
    IF v_existing IS NULL THEN
      INSERT INTO public.notifications (title, description, type)
      VALUES (
        CASE WHEN NEW.actual_yield_pct < v_threshold THEN 'تنبيه: تصافي منخفض' ELSE 'تنبيه: تصافي قريب من الحد' END,
        'دفعة الذبح ' || NEW.batch_number || ' تصافيها ' || ROUND(NEW.actual_yield_pct, 1) || '% (الحد: ' || v_threshold || '%، تحذير: ' || v_warn || '%)',
        'low_yield');
    END IF;
  END IF;
  RETURN NEW;
END; $$;
