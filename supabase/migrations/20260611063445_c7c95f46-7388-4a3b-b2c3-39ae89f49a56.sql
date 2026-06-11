-- Add executive approval workflow to slaughter_batches (تقسيمة دبح النعام)
ALTER TABLE public.slaughter_batches
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending','approved','rejected','cancelled')),
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Backfill: pre-existing batches are treated as approved so the queue doesn't flood
UPDATE public.slaughter_batches
SET approval_status = 'approved', approved_at = COALESCE(approved_at, created_at)
WHERE approval_status = 'pending' AND created_at < now() - interval '1 minute';

-- Index for fast queue lookup
CREATE INDEX IF NOT EXISTS idx_slaughter_batches_approval_status
  ON public.slaughter_batches(approval_status) WHERE approval_status = 'pending';

-- Idempotent RPC: approve a batch (prevents double-approval)
CREATE OR REPLACE FUNCTION public.approve_slaughter_batch(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current text;
BEGIN
  IF NOT (public.has_role(v_actor, 'executive_manager') OR public.has_role(v_actor, 'general_manager')) THEN
    RAISE EXCEPTION 'غير مصرح: يتطلب صلاحية المدير التنفيذي';
  END IF;

  SELECT approval_status INTO v_current FROM public.slaughter_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'التقسيمة غير موجودة';
  END IF;
  IF v_current <> 'pending' THEN
    RAISE EXCEPTION 'تم التعامل مع هذا الطلب بالفعل (الحالة: %)', v_current;
  END IF;

  UPDATE public.slaughter_batches
  SET approval_status = 'approved', approved_by = v_actor, approved_at = now()
  WHERE id = p_batch_id;

  INSERT INTO public.slaughter_audit_log(action, target_type, batch_id, performed_by, old_value, new_value)
  VALUES ('approve_batch', 'slaughter_batch', p_batch_id, v_actor,
          jsonb_build_object('approval_status', v_current),
          jsonb_build_object('approval_status', 'approved'));
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_slaughter_batch(p_batch_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current text;
BEGIN
  IF NOT (public.has_role(v_actor, 'executive_manager') OR public.has_role(v_actor, 'general_manager')) THEN
    RAISE EXCEPTION 'غير مصرح: يتطلب صلاحية المدير التنفيذي';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'سبب الرفض إلزامي (3 أحرف على الأقل)';
  END IF;

  SELECT approval_status INTO v_current FROM public.slaughter_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'التقسيمة غير موجودة';
  END IF;
  IF v_current <> 'pending' THEN
    RAISE EXCEPTION 'تم التعامل مع هذا الطلب بالفعل (الحالة: %)', v_current;
  END IF;

  UPDATE public.slaughter_batches
  SET approval_status = 'rejected', rejected_by = v_actor, rejected_at = now(), rejection_reason = btrim(p_reason)
  WHERE id = p_batch_id;

  INSERT INTO public.slaughter_audit_log(action, target_type, batch_id, performed_by, old_value, new_value)
  VALUES ('reject_batch', 'slaughter_batch', p_batch_id, v_actor,
          jsonb_build_object('approval_status', v_current),
          jsonb_build_object('approval_status', 'rejected', 'reason', btrim(p_reason)));
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_slaughter_batch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_slaughter_batch(uuid, text) TO authenticated;