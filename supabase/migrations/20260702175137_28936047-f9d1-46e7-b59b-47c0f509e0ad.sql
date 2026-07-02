
CREATE TABLE public.order_owner_reassignment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_number text,
  old_owner_id uuid,
  old_owner_name text,
  new_owner_id uuid NOT NULL,
  new_owner_name text,
  reason text NOT NULL,
  changed_by uuid NOT NULL,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_oora_order ON public.order_owner_reassignment_audit(order_id);
CREATE INDEX idx_oora_changed_at ON public.order_owner_reassignment_audit(changed_at DESC);

GRANT SELECT ON public.order_owner_reassignment_audit TO authenticated;
GRANT ALL ON public.order_owner_reassignment_audit TO service_role;

ALTER TABLE public.order_owner_reassignment_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view owner reassignment audit"
ON public.order_owner_reassignment_audit
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','marketing_sales_manager']::app_role[])
);

CREATE OR REPLACE FUNCTION public.reassign_order_owner(
  p_order_id uuid,
  p_new_owner_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_old_owner uuid;
  v_order_number text;
  v_new_name text;
  v_old_name text;
  v_caller_name text;
  v_audit_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.has_any_role(v_caller, ARRAY['general_manager','executive_manager','marketing_sales_manager']::app_role[]) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  IF p_new_owner_id IS NULL THEN
    RAISE EXCEPTION 'new_owner_required';
  END IF;

  SELECT created_by, order_number INTO v_old_owner, v_order_number
  FROM public.orders WHERE id = p_order_id;

  IF v_order_number IS NULL THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF v_old_owner = p_new_owner_id THEN
    RAISE EXCEPTION 'same_owner';
  END IF;

  -- Only allow reassigning to a user with a sales-related role
  IF NOT public.has_any_role(
    p_new_owner_id,
    ARRAY['sales_moderator','sales_manager','marketing_sales_manager']::app_role[]
  ) THEN
    RAISE EXCEPTION 'invalid_new_owner_role';
  END IF;

  SELECT full_name INTO v_new_name FROM public.profile_directory WHERE id = p_new_owner_id;
  SELECT full_name INTO v_old_name FROM public.profile_directory WHERE id = v_old_owner;
  SELECT full_name INTO v_caller_name FROM public.profile_directory WHERE id = v_caller;

  UPDATE public.orders
  SET created_by = p_new_owner_id,
      moderator = COALESCE(v_new_name, moderator)
  WHERE id = p_order_id;

  INSERT INTO public.order_owner_reassignment_audit
    (order_id, order_number, old_owner_id, old_owner_name, new_owner_id, new_owner_name, reason, changed_by, changed_by_name)
  VALUES
    (p_order_id, v_order_number, v_old_owner, v_old_name, p_new_owner_id, v_new_name, btrim(p_reason), v_caller, v_caller_name)
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reassign_order_owner(uuid, uuid, text) TO authenticated;
