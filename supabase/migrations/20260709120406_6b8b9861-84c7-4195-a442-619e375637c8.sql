
CREATE OR REPLACE FUNCTION public.approve_agouza_cash_handover(
  p_handover_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.agouza_warehouse_treasury_txns%ROWTYPE;
  v_main_acc uuid := '382b9a45-3c74-403f-ac0d-0fe3540c4954';
  v_main_id uuid;
  v_ref text;
  v_is_gm_or_exec boolean;
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

  v_is_gm_or_exec := public.has_role(v_uid, 'general_manager'::app_role)
                  OR public.has_role(v_uid, 'executive_manager'::app_role);

  IF v_row.created_by = v_uid AND NOT v_is_gm_or_exec THEN
    RAISE EXCEPTION 'self_approval_forbidden';
  END IF;

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
