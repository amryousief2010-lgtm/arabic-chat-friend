
-- 1) Audit log table for any override / freeze-bypass on closed Agouza days
CREATE TABLE IF NOT EXISTS public.agouza_override_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_date date NOT NULL,
  table_name text NOT NULL,
  operation text NOT NULL, -- INSERT | UPDATE | DELETE | REOPEN
  record_id uuid,
  acted_by uuid NOT NULL DEFAULT auth.uid(),
  acted_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  old_values jsonb,
  new_values jsonb
);

GRANT SELECT, INSERT ON public.agouza_override_audit_log TO authenticated;
GRANT ALL ON public.agouza_override_audit_log TO service_role;

ALTER TABLE public.agouza_override_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agouza_audit_read_managers"
  ON public.agouza_override_audit_log FOR SELECT
  TO authenticated
  USING (public.can_approve_agouza(auth.uid()) OR public.is_agouza_keeper(auth.uid()));

CREATE POLICY "agouza_audit_insert_system"
  ON public.agouza_override_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 2) Replace freeze trigger to also log overrides
CREATE OR REPLACE FUNCTION public.tg_agouza_freeze_closed_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_check_date date;
  v_status text;
  v_record_id uuid;
BEGIN
  -- Resolve the date column depending on table
  IF TG_TABLE_NAME = 'agouza_warehouse_treasury_txns' THEN
    v_check_date := COALESCE(NEW.txn_date, OLD.txn_date)::date;
    v_record_id  := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'agouza_warehouse_reconciliations' THEN
    v_check_date := COALESCE(NEW.reconciliation_date, OLD.reconciliation_date)::date;
    v_record_id  := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'agouza_daily_closures' THEN
    v_check_date := COALESCE(NEW.closure_date, OLD.closure_date)::date;
    v_record_id  := COALESCE(NEW.id, OLD.id);
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_status
  FROM public.agouza_daily_closures
  WHERE closure_date = v_check_date;

  IF v_status = 'closed' THEN
    IF NOT public.can_approve_agouza(auth.uid()) THEN
      RAISE EXCEPTION 'اليوم % مُقفل ولا يمكن تعديله. يلزم Override من المدير العام/التنفيذي.', v_check_date;
    END IF;

    -- Manager override: log it
    INSERT INTO public.agouza_override_audit_log(
      closure_date, table_name, operation, record_id, acted_by, old_values, new_values
    ) VALUES (
      v_check_date,
      TG_TABLE_NAME,
      TG_OP,
      v_record_id,
      auth.uid(),
      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- 3) Attach trigger to reconciliations
DROP TRIGGER IF EXISTS trg_agouza_freeze_recon_ins ON public.agouza_warehouse_reconciliations;
DROP TRIGGER IF EXISTS trg_agouza_freeze_recon_upd ON public.agouza_warehouse_reconciliations;
DROP TRIGGER IF EXISTS trg_agouza_freeze_recon_del ON public.agouza_warehouse_reconciliations;

CREATE TRIGGER trg_agouza_freeze_recon_ins
  BEFORE INSERT ON public.agouza_warehouse_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.tg_agouza_freeze_closed_day();
CREATE TRIGGER trg_agouza_freeze_recon_upd
  BEFORE UPDATE ON public.agouza_warehouse_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.tg_agouza_freeze_closed_day();
CREATE TRIGGER trg_agouza_freeze_recon_del
  BEFORE DELETE ON public.agouza_warehouse_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.tg_agouza_freeze_closed_day();

-- 4) Protect the closure record itself from direct UPDATE/DELETE by non-managers
DROP TRIGGER IF EXISTS trg_agouza_freeze_closure_upd ON public.agouza_daily_closures;
DROP TRIGGER IF EXISTS trg_agouza_freeze_closure_del ON public.agouza_daily_closures;

CREATE TRIGGER trg_agouza_freeze_closure_upd
  BEFORE UPDATE ON public.agouza_daily_closures
  FOR EACH ROW EXECUTE FUNCTION public.tg_agouza_freeze_closed_day();
CREATE TRIGGER trg_agouza_freeze_closure_del
  BEFORE DELETE ON public.agouza_daily_closures
  FOR EACH ROW EXECUTE FUNCTION public.tg_agouza_freeze_closed_day();

-- 5) Update reopen RPC to also log into the override audit log
CREATE OR REPLACE FUNCTION public.agouza_daily_closure_reopen(p_date date, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_approve_agouza(auth.uid()) THEN
    RAISE EXCEPTION 'إعادة الفتح من المدير العام/التنفيذي فقط';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'سبب إعادة الفتح مطلوب';
  END IF;

  UPDATE public.agouza_daily_closures
  SET status='reopened',
      reopened_by = auth.uid(),
      reopened_at = now(),
      reopen_reason = p_reason
  WHERE closure_date = p_date AND status='closed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يوجد إقفال مغلق لهذا اليوم';
  END IF;

  INSERT INTO public.agouza_override_audit_log(
    closure_date, table_name, operation, acted_by, reason
  ) VALUES (
    p_date, 'agouza_daily_closures', 'REOPEN', auth.uid(), p_reason
  );
END;
$function$;
