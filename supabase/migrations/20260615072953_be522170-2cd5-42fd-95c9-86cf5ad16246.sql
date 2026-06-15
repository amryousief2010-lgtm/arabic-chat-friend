CREATE OR REPLACE FUNCTION public.mt_approve_txn(p_txn_id uuid)
 RETURNS main_treasury_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.main_treasury_transactions;
  sib record;
BEGIN
  IF NOT public.is_main_treasury_approver(auth.uid()) THEN
    RAISE EXCEPTION 'صلاحية اعتماد الخزنة الرئيسية فقط';
  END IF;
  SELECT * INTO t FROM public.main_treasury_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المعاملة غير موجودة'; END IF;
  IF t.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'المعاملة ليست في حالة انتظار اعتماد (الحالة: %)', t.status;
  END IF;
  IF t.created_by = auth.uid() THEN RAISE EXCEPTION 'لا يمكن اعتماد حركة سجلتها بنفسك'; END IF;

  -- Attachment is OPTIONAL for incoming transfers. Log when approved without receipt.
  IF t.incoming_source IN ('hyper_healthy','carrefour') AND COALESCE(t.attachment_url,'') = '' THEN
    INSERT INTO public.main_treasury_audit_log(txn_id, action, performed_by, details)
    VALUES (t.id, 'approved_without_attachment', auth.uid(),
            jsonb_build_object('source', t.incoming_source));
  END IF;

  IF t.requires_dual_approval THEN
    IF t.approver_1_id IS NULL THEN
      UPDATE public.main_treasury_transactions
        SET approver_1_id = auth.uid(), approver_1_at = now()
        WHERE id = p_txn_id RETURNING * INTO t;
      RETURN t;
    ELSIF t.approver_1_id = auth.uid() THEN
      RAISE EXCEPTION 'يلزم اعتماد ثاني من معتمد مختلف';
    ELSE
      UPDATE public.main_treasury_transactions
        SET approver_2_id = auth.uid(), approver_2_at = now(),
            status = 'posted', posted_at = now()
        WHERE id = p_txn_id RETURNING * INTO t;
    END IF;
  ELSE
    UPDATE public.main_treasury_transactions
      SET approver_1_id = auth.uid(), approver_1_at = now(),
          status = 'posted', posted_at = now()
      WHERE id = p_txn_id RETURNING * INTO t;
  END IF;

  IF t.transfer_group_id IS NOT NULL THEN
    FOR sib IN SELECT id FROM public.main_treasury_transactions
               WHERE transfer_group_id = t.transfer_group_id AND id <> t.id AND status='pending_approval' FOR UPDATE LOOP
      UPDATE public.main_treasury_transactions
        SET status='posted', posted_at=now(),
            approver_1_id = COALESCE(approver_1_id, auth.uid()),
            approver_1_at = COALESCE(approver_1_at, now())
        WHERE id = sib.id;
    END LOOP;
  END IF;

  RETURN t;
END $function$;