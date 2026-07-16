
CREATE OR REPLACE FUNCTION public.mt_reverse_txn(p_txn_id uuid, p_reason text)
RETURNS SETOF public.main_treasury_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t public.main_treasury_transactions;
  cust_received int;
BEGIN
  IF NOT public.is_main_treasury_approver(auth.uid()) THEN
    RAISE EXCEPTION 'صلاحية إلغاء الحركات متاحة للمدير العام أو التنفيذي فقط';
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'سبب الإلغاء مطلوب';
  END IF;

  SELECT * INTO t FROM public.main_treasury_transactions WHERE id = p_txn_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحركة غير موجودة'; END IF;
  IF t.status IN ('rejected','reversed') THEN
    RAISE EXCEPTION 'الحركة ملغاة بالفعل';
  END IF;

  -- Guard: if this is (or its group contains) a transfer_to_custody that was already received, block it.
  IF t.transfer_group_id IS NOT NULL THEN
    SELECT count(*) INTO cust_received
      FROM public.main_treasury_to_custody_transfers ct
      JOIN public.main_treasury_transactions mt ON mt.id = ct.main_txn_id
     WHERE mt.transfer_group_id = t.transfer_group_id AND ct.status = 'received';
  ELSE
    SELECT count(*) INTO cust_received
      FROM public.main_treasury_to_custody_transfers ct
     WHERE ct.main_txn_id = t.id AND ct.status = 'received';
  END IF;
  IF cust_received > 0 THEN
    RAISE EXCEPTION 'لا يمكن إلغاء تحويل عهدة تم استلامه بالفعل';
  END IF;

  -- Reverse the txn (and paired legs if part of a transfer group)
  IF t.transfer_group_id IS NOT NULL THEN
    UPDATE public.main_treasury_transactions
       SET status = 'reversed',
           rejection_reason = p_reason,
           updated_at = now()
     WHERE transfer_group_id = t.transfer_group_id
       AND status NOT IN ('rejected','reversed');

    -- Cancel any pending/sent custody-transfer child rows in the same group
    UPDATE public.main_treasury_to_custody_transfers
       SET status = 'rejected'
     WHERE main_txn_id IN (
        SELECT id FROM public.main_treasury_transactions WHERE transfer_group_id = t.transfer_group_id
     ) AND status <> 'received';
  ELSE
    UPDATE public.main_treasury_transactions
       SET status = 'reversed',
           rejection_reason = p_reason,
           updated_at = now()
     WHERE id = t.id;

    UPDATE public.main_treasury_to_custody_transfers
       SET status = 'rejected'
     WHERE main_txn_id = t.id AND status <> 'received';
  END IF;

  RETURN QUERY
    SELECT * FROM public.main_treasury_transactions
     WHERE id = t.id OR (t.transfer_group_id IS NOT NULL AND transfer_group_id = t.transfer_group_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mt_reverse_txn(uuid, text) TO authenticated;
