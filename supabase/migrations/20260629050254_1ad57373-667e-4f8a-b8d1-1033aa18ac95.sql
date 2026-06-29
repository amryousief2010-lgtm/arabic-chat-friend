
-- =============================================================
-- M2: Agouza Treasury - Handover RPCs
-- =============================================================

-- ---- Extend treasury txns with status/approval fields ----
ALTER TABLE public.agouza_warehouse_treasury_txns
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted'
    CHECK (status IN ('pending','approved','rejected','posted','reversed')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS main_treasury_txn_id uuid;

CREATE INDEX IF NOT EXISTS idx_agouza_treas_status ON public.agouza_warehouse_treasury_txns(status);

-- =============================================================
-- submit_agouza_cash_handover
--   Caller: agouza_warehouse_keeper (or GM/Exec).
--   Creates a PENDING outflow row in agouza treasury. Does NOT
--   touch main treasury. Funds are NOT removed from agouza balance
--   computation until approved (we filter status='approved' or 'posted').
-- =============================================================
CREATE OR REPLACE FUNCTION public.submit_agouza_cash_handover(
  p_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_no text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF NOT public.can_manage_agouza(v_uid) THEN
    RAISE EXCEPTION 'not_authorized: only agouza keeper or managers can submit handover';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  v_no := 'AGZ-HND-' || to_char(now() AT TIME ZONE 'Africa/Cairo','YYMMDDHH24MISS')
          || '-' || substr(gen_random_uuid()::text, 1, 6);

  INSERT INTO public.agouza_warehouse_treasury_txns(
    txn_no, txn_date, txn_type, direction, amount,
    notes, status, created_by
  ) VALUES (
    v_no, now(), 'handover_to_main', 'out', p_amount,
    p_notes, 'pending', v_uid
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_agouza_cash_handover(numeric, text) TO authenticated;

-- =============================================================
-- approve_agouza_cash_handover
--   Caller: general_manager or executive_manager ONLY.
--   Cannot approve own submission.
--   Creates a posted row in main_treasury_transactions (incoming).
-- =============================================================
CREATE OR REPLACE FUNCTION public.approve_agouza_cash_handover(
  p_handover_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.agouza_warehouse_treasury_txns%ROWTYPE;
  v_main_acc uuid := '382b9a45-3c74-403f-ac0d-0fe3540c4954'; -- الخزنة الرئيسية — نقدي
  v_main_id uuid;
  v_ref text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  IF NOT public.can_approve_agouza(v_uid) THEN
    RAISE EXCEPTION 'not_authorized: only GM or executive can approve';
  END IF;

  SELECT * INTO v_row FROM public.agouza_warehouse_treasury_txns
   WHERE id = p_handover_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'handover_not_found'; END IF;
  IF v_row.txn_type <> 'handover_to_main' THEN RAISE EXCEPTION 'not_a_handover'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'handover_not_pending: status=%', v_row.status; END IF;
  IF v_row.created_by = v_uid THEN RAISE EXCEPTION 'self_approval_forbidden'; END IF;

  v_ref := 'AGZ-IN-' || to_char(now() AT TIME ZONE 'Africa/Cairo','YYMMDDHH24MISS');

  INSERT INTO public.main_treasury_transactions(
    reference_no, account_id, txn_type, amount, txn_date,
    counterparty, description, status,
    incoming_source, cash_handover_by, created_by, posted_at
  ) VALUES (
    v_ref, v_main_acc, 'incoming', v_row.amount, CURRENT_DATE,
    'خزنة مخزن العجوزة',
    COALESCE('توريد نقدية من العجوزة — ' || v_row.txn_no
             || CASE WHEN v_row.notes IS NOT NULL THEN ' — ' || v_row.notes ELSE '' END,
             v_row.txn_no),
    'posted', 'agouza_warehouse',
    (SELECT full_name FROM public.profiles WHERE id = v_row.created_by),
    v_uid, now()
  )
  RETURNING id INTO v_main_id;

  UPDATE public.agouza_warehouse_treasury_txns
     SET status = 'approved',
         approved_by = v_uid,
         approved_at = now(),
         main_treasury_txn_id = v_main_id
   WHERE id = p_handover_id;

  RETURN v_main_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_agouza_cash_handover(uuid) TO authenticated;

-- =============================================================
-- reject_agouza_cash_handover
--   Caller: GM/Exec only. Keeps the row as 'rejected' (audit).
-- =============================================================
CREATE OR REPLACE FUNCTION public.reject_agouza_cash_handover(
  p_handover_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.agouza_warehouse_treasury_txns%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  IF NOT public.can_approve_agouza(v_uid) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT * INTO v_row FROM public.agouza_warehouse_treasury_txns
   WHERE id = p_handover_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'handover_not_found'; END IF;
  IF v_row.txn_type <> 'handover_to_main' THEN RAISE EXCEPTION 'not_a_handover'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'handover_not_pending'; END IF;

  UPDATE public.agouza_warehouse_treasury_txns
     SET status = 'rejected',
         rejected_by = v_uid,
         rejected_at = now(),
         rejection_reason = p_reason
   WHERE id = p_handover_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_agouza_cash_handover(uuid, text) TO authenticated;
