-- Extend line_type to include 'handover'
ALTER TABLE public.courier_goods_custody_lines DROP CONSTRAINT IF EXISTS courier_goods_custody_lines_line_type_check;
ALTER TABLE public.courier_goods_custody_lines ADD CONSTRAINT courier_goods_custody_lines_line_type_check
  CHECK (line_type = ANY (ARRAY['issue','return','sale','cash_collect','bonus','handover']));

CREATE OR REPLACE FUNCTION public.submit_courier_cash_handover(
  p_custody_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_custody RECORD;
  v_courier text;
  v_reference text;
  v_collected numeric := 0;
  v_handed_over numeric := 0;
  v_net_cash numeric := 0;
  v_existing uuid;
  v_txn_id uuid;
  v_line_id uuid;
BEGIN
  IF p_custody_id IS NULL THEN RAISE EXCEPTION 'custody_id is required'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'المبلغ غير صالح'; END IF;

  SELECT id, courier_name, status INTO v_custody
  FROM public.courier_goods_custodies WHERE id = p_custody_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العهدة غير موجودة'; END IF;
  v_courier := v_custody.courier_name;

  v_reference := 'HND-' || COALESCE(NULLIF(p_idempotency_key,''),
                  to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS') || '-' || substr(p_custody_id::text,1,6));

  -- Idempotency check
  SELECT id INTO v_existing FROM public.courier_goods_custody_lines
  WHERE custody_id = p_custody_id AND line_type = 'handover' AND notes LIKE '%' || v_reference || '%'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('reference', v_reference, 'line_id', v_existing, 'idempotent_hit', true);
  END IF;

  -- Compute net cash available
  SELECT COALESCE(SUM(cash_collected),0) INTO v_collected
  FROM public.courier_goods_custody_lines
  WHERE custody_id = p_custody_id AND line_type IN ('sale','cash_collect');

  SELECT COALESCE(SUM(ABS(cash_collected)),0) INTO v_handed_over
  FROM public.courier_goods_custody_lines
  WHERE custody_id = p_custody_id AND line_type = 'handover';

  v_net_cash := v_collected - v_handed_over;

  IF p_amount > v_net_cash THEN
    RAISE EXCEPTION 'المبلغ المطلوب توريده (%) أكبر من صافي نقدية العهدة (%)', p_amount, v_net_cash;
  END IF;

  -- 1) Deduct from custody
  INSERT INTO public.courier_goods_custody_lines(
    custody_id, line_type, product_name, quantity, unit,
    unit_price, total_value, cash_collected,
    performed_at, performed_by, notes
  ) VALUES (
    p_custody_id, 'handover', 'توريد نقدية للخزينة', 1, 'تحويل',
    p_amount, p_amount, -p_amount,
    now(), v_user,
    'توريد نقدية — ' || v_reference || COALESCE(' | ' || NULLIF(p_notes,''), '')
  ) RETURNING id INTO v_line_id;

  -- 2) Create pending treasury txn at main warehouse treasury
  INSERT INTO public.main_warehouse_treasury_txns(
    direction, category, amount, courier_name, notes,
    performed_by, status, performed_at
  ) VALUES (
    'in', 'courier_deposit', p_amount, v_courier,
    'بانتظار اعتماد محمد شعلة — ' || v_reference || COALESCE(' | ' || NULLIF(p_notes,''), ''),
    v_user, 'pending_approval', now()
  ) RETURNING id INTO v_txn_id;

  -- 3) Notify approvers
  BEGIN
    INSERT INTO public.notifications(user_id, type, title, message, read)
    SELECT DISTINCT user_id, 'courier_cash_handover_pending',
      'توريد نقدية جديد بانتظار الاعتماد',
      'المندوب ' || v_courier || ' ورّد ' || p_amount::text || ' ج.م — مرجع ' || v_reference,
      false
    FROM public.user_roles
    WHERE role IN ('financial_manager','main_treasury_approver','general_manager');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'reference', v_reference,
    'line_id', v_line_id,
    'txn_id', v_txn_id,
    'amount', p_amount,
    'net_cash_before', v_net_cash,
    'net_cash_after', v_net_cash - p_amount,
    'idempotent_hit', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_courier_cash_handover(uuid, numeric, text, text) TO authenticated;