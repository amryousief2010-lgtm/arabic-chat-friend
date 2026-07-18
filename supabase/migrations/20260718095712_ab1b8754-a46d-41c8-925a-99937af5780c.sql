
-- 1) Audit table for receipt dispositions (previously_received / deleted while pending)
CREATE TABLE IF NOT EXISTS public.receipt_disposition_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                      -- 'slaughter' | 'meat_factory' | 'internal'
  ref_id uuid NOT NULL,                    -- batch_id / transfer_id
  ref_no text,
  action text NOT NULL,                    -- 'previously_received' | 'deleted_pending'
  reason text,
  performed_by uuid REFERENCES auth.users(id),
  performed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.receipt_disposition_audit TO authenticated;
GRANT ALL ON public.receipt_disposition_audit TO service_role;
ALTER TABLE public.receipt_disposition_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth view receipt disposition audit"
  ON public.receipt_disposition_audit FOR SELECT TO authenticated USING (true);
CREATE POLICY "managers insert receipt disposition audit"
  ON public.receipt_disposition_audit FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
    OR has_role(auth.uid(), 'warehouse_supervisor'::app_role)
  );

-- 2) Widen meat_production_transfers status to include 'received_previously'
ALTER TABLE public.meat_production_transfers
  DROP CONSTRAINT IF EXISTS meat_production_transfers_status_chk;
ALTER TABLE public.meat_production_transfers
  ADD CONSTRAINT meat_production_transfers_status_chk
  CHECK (status = ANY (ARRAY['pending','received','rejected','received_previously']));

-- 3) RPC: mark_receipt_previously_received
--    Closes a pending legacy transfer WITHOUT any inventory movement.
CREATE OR REPLACE FUNCTION public.mark_receipt_previously_received(
  p_kind text,
  p_ref_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_ref_no text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;
  IF NOT (
    has_role(v_uid, 'general_manager'::app_role)
    OR has_role(v_uid, 'executive_manager'::app_role)
    OR has_role(v_uid, 'warehouse_supervisor'::app_role)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF coalesce(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_uid;

  IF p_kind = 'slaughter' THEN
    SELECT batch_number INTO v_ref_no FROM public.slaughter_batches WHERE id = p_ref_id;
    -- Only touch outputs that were not already received into stock.
    UPDATE public.slaughter_batch_outputs
       SET received_status = 'received_previously',
           received_at = now(),
           received_by = v_uid,
           notes = coalesce(notes,'') || E'\n[موردة سابقًا: ' || p_reason || ']'
     WHERE batch_id = p_ref_id
       AND received_status <> 'received';

  ELSIF p_kind = 'meat_factory' THEN
    SELECT transfer_no INTO v_ref_no FROM public.meat_production_transfers WHERE id = p_ref_id;
    UPDATE public.meat_production_transfers
       SET status = 'received_previously',
           notes = coalesce(notes,'') || E'\n[موردة سابقًا: ' || p_reason || ']'
     WHERE id = p_ref_id
       AND status = 'pending';

  ELSIF p_kind = 'internal' THEN
    SELECT transfer_no INTO v_ref_no FROM public.warehouse_transfers WHERE id = p_ref_id;
    UPDATE public.warehouse_transfers
       SET status = 'cancelled',
           notes = coalesce(notes,'') || E'\n[موردة سابقًا: ' || p_reason || ']'
     WHERE id = p_ref_id
       AND status IN ('pending_receipt','pending_approval','sent','draft');
  ELSE
    RAISE EXCEPTION 'unknown_kind: %', p_kind;
  END IF;

  INSERT INTO public.receipt_disposition_audit(kind, ref_id, ref_no, action, reason, performed_by, performed_by_name)
  VALUES (p_kind, p_ref_id, v_ref_no, 'previously_received', p_reason, v_uid, v_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_receipt_previously_received(text, uuid, text) TO authenticated;
