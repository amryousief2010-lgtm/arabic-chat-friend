
-- 1) Add source + attachment metadata columns
ALTER TABLE public.main_treasury_transactions
  ADD COLUMN IF NOT EXISTS incoming_source text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_mime text,
  ADD COLUMN IF NOT EXISTS attachment_size bigint,
  ADD COLUMN IF NOT EXISTS attachment_uploaded_by uuid,
  ADD COLUMN IF NOT EXISTS attachment_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS attachment_change_reason text;

COMMENT ON COLUMN public.main_treasury_transactions.incoming_source IS
  'For incoming bank transfers: hyper_healthy | carrefour | direct_customer | other';

-- 2) Audit-log helper: log attachment uploads / changes
CREATE OR REPLACE FUNCTION public.mt_audit_attachment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.attachment_url IS NOT NULL THEN
    INSERT INTO public.main_treasury_audit_log(txn_id, action, performed_by, details)
    VALUES (NEW.id, 'attachment_uploaded', COALESCE(NEW.attachment_uploaded_by, NEW.created_by),
            jsonb_build_object('name', NEW.attachment_name, 'mime', NEW.attachment_mime,
                               'size', NEW.attachment_size, 'source', NEW.incoming_source));
  ELSIF TG_OP = 'UPDATE' AND COALESCE(NEW.attachment_url,'') IS DISTINCT FROM COALESCE(OLD.attachment_url,'') THEN
    INSERT INTO public.main_treasury_audit_log(txn_id, action, performed_by, details)
    VALUES (NEW.id,
            CASE WHEN NEW.attachment_url IS NULL THEN 'attachment_deleted'
                 WHEN OLD.attachment_url IS NULL THEN 'attachment_uploaded'
                 ELSE 'attachment_changed' END,
            COALESCE(NEW.attachment_uploaded_by, auth.uid()),
            jsonb_build_object('old', OLD.attachment_url, 'new', NEW.attachment_url,
                               'name', NEW.attachment_name, 'reason', NEW.attachment_change_reason,
                               'source', NEW.incoming_source));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mt_audit_attachment ON public.main_treasury_transactions;
CREATE TRIGGER trg_mt_audit_attachment
  AFTER INSERT OR UPDATE OF attachment_url ON public.main_treasury_transactions
  FOR EACH ROW EXECUTE FUNCTION public.mt_audit_attachment();

-- 3) Update approval function: block Hyper/Carrefour approvals without attachment
CREATE OR REPLACE FUNCTION public.mt_approve_txn(p_txn_id uuid)
RETURNS main_treasury_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Mandatory attachment for Hyper / Carrefour incoming transfers
  IF t.incoming_source IN ('hyper_healthy','carrefour') AND COALESCE(t.attachment_url,'') = '' THEN
    INSERT INTO public.main_treasury_audit_log(txn_id, action, performed_by, details)
    VALUES (t.id, 'approve_blocked_no_attachment', auth.uid(),
            jsonb_build_object('source', t.incoming_source));
    RAISE EXCEPTION 'يجب إرفاق صورة التحويل قبل اعتماد هذه الحركة';
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
