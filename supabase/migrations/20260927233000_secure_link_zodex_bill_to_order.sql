-- link_zodex_bill_to_order is SECURITY DEFINER. Callers today are the Zodex
-- review screen (ZodexReview.doFix and LinkBillToOrderDialog). No edge function
-- or other SQL function calls it. A null auth.uid() (service_role) still passes.

CREATE OR REPLACE FUNCTION public.link_zodex_bill_to_order(
  p_bill_no text,
  p_order_id uuid,
  p_missing_id uuid DEFAULT NULL,
  p_match_score numeric DEFAULT NULL,
  p_match_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill text := trim(p_bill_no);
  v_existing_order_id uuid;
  v_previous_bill text;
  v_user uuid := auth.uid();
  v_user_name text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::public.app_role,
    'executive_manager'::public.app_role,
    'warehouse_supervisor'::public.app_role,
    'agouza_warehouse_keeper'::public.app_role,
    'sales_manager'::public.app_role,
    'marketing_sales_manager'::public.app_role,
    'marketing_sales_viewer'::public.app_role,
    'financial_manager'::public.app_role,
    'accountant'::public.app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_bill IS NULL OR v_bill = '' THEN
    RAISE EXCEPTION 'رقم البوليصة مطلوب';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'رقم الأوردر مطلوب';
  END IF;

  -- Duplicate guard: same bill on another order
  SELECT id, shipping_bill_no INTO v_existing_order_id, v_previous_bill
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_existing_order_id IS NULL THEN
    RAISE EXCEPTION 'الأوردر غير موجود';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE shipping_bill_no = v_bill AND id <> p_order_id
  ) THEN
    RAISE EXCEPTION 'البوليصة % مربوطة بالفعل بأوردر آخر', v_bill;
  END IF;

  UPDATE public.orders
     SET shipping_bill_no = v_bill,
         updated_at = now()
   WHERE id = p_order_id;

  IF p_missing_id IS NOT NULL THEN
    UPDATE public.zodex_missing_orders
       SET status = 'resolved',
           resolved_order_id = p_order_id,
           resolved_by = v_user,
           resolved_at = now()
     WHERE id = p_missing_id;
  ELSE
    UPDATE public.zodex_missing_orders
       SET status = 'resolved',
           resolved_order_id = p_order_id,
           resolved_by = v_user,
           resolved_at = now()
     WHERE bill_no = v_bill AND status <> 'resolved';
  END IF;

  SELECT COALESCE(full_name, email) INTO v_user_name
    FROM public.profiles WHERE id = v_user;

  INSERT INTO public.zodex_bill_link_audit
    (bill_no, order_id, missing_id, linked_by, linked_by_name, match_score, match_reason, previous_bill_no)
  VALUES
    (v_bill, p_order_id, p_missing_id, v_user, v_user_name, p_match_score, p_match_reason, v_previous_bill);

  RETURN jsonb_build_object('ok', true, 'bill_no', v_bill, 'order_id', p_order_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_zodex_bill_to_order(text, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_zodex_bill_to_order(text, uuid, uuid, numeric, text) TO authenticated, service_role;
