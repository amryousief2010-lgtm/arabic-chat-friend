-- Keep pending-approval notifications in sync with the approval row.
-- Create paths already insert unread notices; decide/approve/reject did not
-- mark them read, so GM/exec/marketing badges stayed stale.
-- Matching rules are mirrored in src/lib/approvalNotificationSync.ts.

-- ── Duplicate order: stamp [ref:<approval_id>] on new pending notices ────
CREATE OR REPLACE FUNCTION public.request_duplicate_order_approval(p_customer_id uuid, p_note text DEFAULT NULL::text, p_matched_order_id uuid DEFAULT NULL::uuid, p_duplicate_score numeric DEFAULT NULL::numeric, p_proposed_order jsonb DEFAULT '{}'::jsonb, p_proposed_items jsonb DEFAULT '[]'::jsonb, p_attempt_audit_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_existing uuid;
  v_cust_name text;
  v_moderator_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT id INTO v_existing
  FROM public.duplicate_order_approvals
  WHERE customer_id = p_customer_id
    AND requested_by = v_uid
    AND status = 'pending'
    AND expires_at > now()
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.duplicate_order_approvals
    SET note = COALESCE(NULLIF(trim(p_note), ''), note),
        matched_order_id = COALESCE(p_matched_order_id, matched_order_id),
        duplicate_score = COALESCE(p_duplicate_score, duplicate_score),
        proposed_order = CASE WHEN p_proposed_order = '{}'::jsonb THEN proposed_order ELSE p_proposed_order END,
        proposed_items = CASE WHEN p_proposed_items = '[]'::jsonb THEN proposed_items ELSE p_proposed_items END,
        updated_at = now()
    WHERE id = v_existing;

    v_id := v_existing;
  ELSE
    INSERT INTO public.duplicate_order_approvals (
      customer_id, requested_by, note, matched_order_id, duplicate_score, proposed_order, proposed_items
    )
    VALUES (
      p_customer_id, v_uid, p_note, p_matched_order_id, p_duplicate_score,
      COALESCE(p_proposed_order, '{}'::jsonb), COALESCE(p_proposed_items, '[]'::jsonb)
    )
    RETURNING id INTO v_id;

    SELECT name INTO v_cust_name FROM public.customers WHERE id = p_customer_id;
    SELECT full_name INTO v_moderator_name FROM public.profiles WHERE id = v_uid;

    INSERT INTO public.notifications (title, description, type, target_user_id)
    SELECT
      'طلب موافقة تسجيل أوردر مكرر',
      'المودريتور ' || COALESCE(v_moderator_name, '—') || ' تطلب موافقة لتسجيل طلب مكرر للعميل ' || COALESCE(v_cust_name, '—') ||
        CASE WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN ' — ' || p_note ELSE '' END ||
        ' [ref:' || v_id::text || ']',
      'duplicate_order_approval',
      ur.user_id
    FROM public.user_roles ur
    WHERE ur.role IN ('marketing_sales_manager', 'general_manager');
  END IF;

  IF p_attempt_audit_id IS NOT NULL THEN
    UPDATE public.duplicate_order_attempt_audit
    SET approval_id = v_id,
        status = 'request_created',
        updated_at = now()
    WHERE id = p_attempt_audit_id
      AND attempted_by = v_uid;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_clear_duplicate_approval_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust text;
  v_req text;
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    SELECT name INTO v_cust FROM public.customers WHERE id = NEW.customer_id;
    SELECT full_name INTO v_req FROM public.profiles WHERE id = NEW.requested_by;

    UPDATE public.notifications
    SET is_read = true
    WHERE is_read = false
      AND type = 'duplicate_order_approval'
      AND title IN (
        'طلب موافقة تسجيل أوردر مكرر',
        'طلب اعتماد أوردر مكرر بانتظارك'
      )
      AND (
        description LIKE '%[ref:' || NEW.id::text || ']%'
        OR (
          COALESCE(v_cust, '') NOT IN ('', '—')
          AND COALESCE(v_req, '') NOT IN ('', '—')
          AND position(v_cust in description) > 0
          AND position(v_req in description) > 0
        )
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_duplicate_approval_notifications ON public.duplicate_order_approvals;
CREATE TRIGGER trg_clear_duplicate_approval_notifications
AFTER UPDATE OF status ON public.duplicate_order_approvals
FOR EACH ROW
WHEN (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
EXECUTE FUNCTION public.trg_clear_duplicate_approval_notifications();

-- ── Treasury pending transfer-to-custody ────────────────────────────────
CREATE OR REPLACE FUNCTION public.mt_notify_pending_transfer_to_custody()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
BEGIN
  IF NEW.txn_type = 'transfer_to_custody' AND NEW.status = 'pending_approval' THEN
    FOR rec IN
      SELECT DISTINCT user_id FROM public.user_roles
      WHERE role IN ('general_manager','executive_manager')
    LOOP
      INSERT INTO public.notifications(title, description, type, target_user_id)
      VALUES (
        'طلب توريد جديد بانتظار الاعتماد',
        'يوجد طلب توريد جديد من الخزنة الرئيسية إلى خزنة العهدة بمبلغ '
          || to_char(NEW.amount, 'FM999,999,990.00') || ' ج.م بانتظار الاعتماد'
          || ' [ref:' || NEW.id::text || ']',
        'treasury_transfer_pending',
        rec.user_id
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_clear_treasury_approval_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amt text;
BEGIN
  IF OLD.status = 'pending_approval' AND NEW.status IN ('approved', 'posted', 'rejected', 'cancelled') THEN
    v_amt := to_char(NEW.amount, 'FM999,999,990.00');

    UPDATE public.notifications
    SET is_read = true
    WHERE is_read = false
      AND type = 'treasury_transfer_pending'
      AND (
        description LIKE '%[ref:' || NEW.id::text || ']%'
        OR (
          NEW.txn_type = 'transfer_to_custody'
          AND position(v_amt in description) > 0
          AND created_at BETWEEN NEW.created_at - interval '15 seconds'
                             AND NEW.created_at + interval '15 seconds'
        )
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_treasury_approval_notifications ON public.main_treasury_transactions;
CREATE TRIGGER trg_clear_treasury_approval_notifications
AFTER UPDATE OF status ON public.main_treasury_transactions
FOR EACH ROW
WHEN (OLD.status = 'pending_approval' AND NEW.status IN ('approved', 'posted', 'rejected', 'cancelled'))
EXECUTE FUNCTION public.trg_clear_treasury_approval_notifications();

-- ── Feed production invoices ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_clear_feed_production_approval_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending_approval' AND NEW.status IN ('approved', 'rejected', 'cancelled')
     AND COALESCE(NEW.prod_no, '') <> '' THEN
    UPDATE public.notifications
    SET is_read = true
    WHERE is_read = false
      AND type = 'feed_production_approval'
      AND position(NEW.prod_no in description) > 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_feed_production_approval_notifications ON public.feed_production_invoices;
CREATE TRIGGER trg_clear_feed_production_approval_notifications
AFTER UPDATE OF status ON public.feed_production_invoices
FOR EACH ROW
WHEN (OLD.status = 'pending_approval' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
EXECUTE FUNCTION public.trg_clear_feed_production_approval_notifications();

-- ── Order edit requests (client also marks read; trigger is source of truth)
CREATE OR REPLACE FUNCTION public.trg_clear_edit_request_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') AND NEW.order_id IS NOT NULL THEN
    UPDATE public.notifications
    SET is_read = true
    WHERE is_read = false
      AND type = 'edit_request'
      AND order_id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_edit_request_notifications ON public.order_edit_requests;
CREATE TRIGGER trg_clear_edit_request_notifications
AFTER UPDATE OF status ON public.order_edit_requests
FOR EACH ROW
WHEN (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
EXECUTE FUNCTION public.trg_clear_edit_request_notifications();
