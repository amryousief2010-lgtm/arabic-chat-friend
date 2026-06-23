
-- 1) Add cancellation columns to feed_factory_treasury_txns
ALTER TABLE public.feed_factory_treasury_txns
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE public.feed_factory_treasury_txns
  DROP CONSTRAINT IF EXISTS feed_factory_treasury_txns_status_chk;
ALTER TABLE public.feed_factory_treasury_txns
  ADD CONSTRAINT feed_factory_treasury_txns_status_chk CHECK (status IN ('active','cancelled'));

-- 2) RPC: soft-cancel a feed factory treasury txn (restores balance because
--    UI/views must filter by status='active').
CREATE OR REPLACE FUNCTION public.feed_treasury_cancel_txn(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.feed_factory_treasury_txns%ROWTYPE;
  v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'CANCEL_REASON_REQUIRED';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role::text IN ('general_manager','executive_manager','feed_factory_manager','warehouse_supervisor')
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT * INTO v_row FROM public.feed_factory_treasury_txns WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TXN_NOT_FOUND';
  END IF;
  IF v_row.status = 'cancelled' THEN
    RAISE EXCEPTION 'ALREADY_CANCELLED';
  END IF;
  IF v_row.kind IN ('sale','purchase') THEN
    RAISE EXCEPTION 'LINKED_TO_INVOICE';
  END IF;

  UPDATE public.feed_factory_treasury_txns
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_uid,
         cancellation_reason = btrim(p_reason)
   WHERE id = p_id;

  INSERT INTO public.feed_audit_log(table_name,row_id,action,old_value,new_value,performed_by,notes)
  VALUES (
    'feed_factory_treasury_txns', p_id, 'cancel_txn',
    to_jsonb(v_row),
    jsonb_build_object('status','cancelled','cancellation_reason', btrim(p_reason)),
    v_uid, btrim(p_reason)
  );

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'restored_amount', v_row.amount, 'direction', v_row.direction);
END;
$$;

GRANT EXECUTE ON FUNCTION public.feed_treasury_cancel_txn(uuid, text) TO authenticated;
