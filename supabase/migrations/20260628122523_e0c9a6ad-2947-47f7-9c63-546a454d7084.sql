
CREATE TABLE IF NOT EXISTS public.courier_assignment_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.courier_order_assignments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  courier_name text,
  action text NOT NULL CHECK (action IN ('edit_collection_amount','reverse_collection','reverse_return')),
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text NOT NULL,
  performed_by uuid REFERENCES auth.users(id),
  performed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.courier_assignment_corrections TO authenticated;
GRANT ALL ON public.courier_assignment_corrections TO service_role;

ALTER TABLE public.courier_assignment_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers_can_read_corrections"
ON public.courier_assignment_corrections FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'general_manager'::app_role)
  OR public.has_role(auth.uid(),'executive_manager'::app_role)
  OR public.has_role(auth.uid(),'financial_manager'::app_role)
  OR public.has_role(auth.uid(),'main_treasury_approver'::app_role)
);

CREATE POLICY "managers_can_insert_corrections"
ON public.courier_assignment_corrections FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'general_manager'::app_role)
  OR public.has_role(auth.uid(),'executive_manager'::app_role)
  OR public.has_role(auth.uid(),'financial_manager'::app_role)
  OR public.has_role(auth.uid(),'main_treasury_approver'::app_role)
);

CREATE OR REPLACE FUNCTION public.correct_courier_assignment(
  p_assignment_id uuid,
  p_action text,
  p_reason text,
  p_new_amount numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_assign public.courier_order_assignments%ROWTYPE;
  v_collection public.pc_collections%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_closure_exists boolean;
BEGIN
  IF NOT (
    public.has_role(v_uid,'general_manager'::app_role)
    OR public.has_role(v_uid,'executive_manager'::app_role)
    OR public.has_role(v_uid,'financial_manager'::app_role)
    OR public.has_role(v_uid,'main_treasury_approver'::app_role)
  ) THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ هذا التصحيح';
  END IF;

  IF coalesce(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'سبب التصحيح مطلوب';
  END IF;

  SELECT * INTO v_assign FROM public.courier_order_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'التعيين غير موجود'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.courier_daily_closures
    WHERE courier_name = v_assign.courier_name
      AND closure_date = (v_assign.assigned_at AT TIME ZONE 'Africa/Cairo')::date
      AND status = 'closed'
  ) INTO v_closure_exists;
  IF v_closure_exists THEN
    RAISE EXCEPTION 'لا يمكن التعديل بعد إقفال يوم العهدة';
  END IF;

  v_before := to_jsonb(v_assign);

  IF p_action = 'edit_collection_amount' THEN
    IF p_new_amount IS NULL OR p_new_amount < 0 THEN
      RAISE EXCEPTION 'قيمة التحصيل غير صحيحة';
    END IF;
    SELECT * INTO v_collection FROM public.pc_collections WHERE order_id = v_assign.order_id ORDER BY collected_at DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد تحصيل مسجل لتعديله'; END IF;
    UPDATE public.pc_collections
      SET amount_collected = p_new_amount,
          difference = amount_due - p_new_amount,
          updated_at = now()
      WHERE id = v_collection.id;

  ELSIF p_action = 'reverse_collection' THEN
    DELETE FROM public.pc_collections WHERE order_id = v_assign.order_id;
    UPDATE public.courier_order_assignments
      SET collected_at = NULL, status = 'delivered', updated_at = now()
      WHERE id = p_assignment_id;
    UPDATE public.pc_order_tracking SET courier_status = 'delivered', updated_at = now()
      WHERE order_id = v_assign.order_id;

  ELSIF p_action = 'reverse_return' THEN
    DELETE FROM public.pc_failed_attempts WHERE order_id = v_assign.order_id;
    UPDATE public.courier_order_assignments
      SET returned_at = NULL, status = 'out_for_delivery', updated_at = now()
      WHERE id = p_assignment_id;
    UPDATE public.pc_order_tracking SET courier_status = 'out_for_delivery', updated_at = now()
      WHERE order_id = v_assign.order_id;

  ELSE
    RAISE EXCEPTION 'نوع التصحيح غير معروف: %', p_action;
  END IF;

  SELECT to_jsonb(a) INTO v_after FROM public.courier_order_assignments a WHERE id = p_assignment_id;

  INSERT INTO public.courier_assignment_corrections
    (assignment_id, order_id, courier_name, action, before_snapshot, after_snapshot, reason, performed_by)
  VALUES (p_assignment_id, v_assign.order_id, v_assign.courier_name, p_action, v_before, v_after, p_reason, v_uid);

  RETURN jsonb_build_object('success', true, 'action', p_action);
END;
$$;

GRANT EXECUTE ON FUNCTION public.correct_courier_assignment(uuid, text, text, numeric) TO authenticated;
