
CREATE OR REPLACE FUNCTION public.approve_courier_cash_handover(
  p_txn_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_txn RECORD;
BEGIN
  IF p_txn_id IS NULL THEN RAISE EXCEPTION 'txn_id is required'; END IF;

  -- Optional role gate
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user
      AND role IN ('financial_manager','main_treasury_approver','general_manager','admin')
  ) THEN
    RAISE EXCEPTION 'صلاحية غير كافية لاعتماد التوريد';
  END IF;

  SELECT * INTO v_txn FROM public.main_warehouse_treasury_txns
  WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحركة غير موجودة'; END IF;
  IF v_txn.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'هذه الحركة ليست بانتظار الاعتماد (الحالة: %)', v_txn.status;
  END IF;
  IF v_txn.category <> 'courier_deposit' THEN
    RAISE EXCEPTION 'هذه الحركة ليست توريد نقدية مندوب';
  END IF;

  UPDATE public.main_warehouse_treasury_txns
  SET status = 'approved',
      approved_by = v_user,
      approved_at = now(),
      notes = COALESCE(notes,'') || COALESCE(' | اعتماد: ' || NULLIF(p_note,''), '')
  WHERE id = p_txn_id;

  BEGIN
    INSERT INTO public.notifications(user_id, type, title, message, read)
    SELECT DISTINCT user_id, 'courier_cash_handover_approved',
      'تم اعتماد التوريد',
      'تم اعتماد توريد ' || v_txn.amount::text || ' ج.م من المندوب ' || COALESCE(v_txn.courier_name,''),
      false
    FROM public.user_roles
    WHERE role IN ('warehouse_manager','financial_manager');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'txn_id', p_txn_id, 'amount', v_txn.amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_courier_cash_handover(
  p_txn_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_txn RECORD;
  v_custody_id uuid;
  v_line_id uuid;
BEGIN
  IF p_txn_id IS NULL THEN RAISE EXCEPTION 'txn_id is required'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'سبب الرفض مطلوب';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user
      AND role IN ('financial_manager','main_treasury_approver','general_manager','admin')
  ) THEN
    RAISE EXCEPTION 'صلاحية غير كافية لرفض التوريد';
  END IF;

  SELECT * INTO v_txn FROM public.main_warehouse_treasury_txns
  WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحركة غير موجودة'; END IF;
  IF v_txn.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'هذه الحركة ليست بانتظار الاعتماد (الحالة: %)', v_txn.status;
  END IF;
  IF v_txn.category <> 'courier_deposit' THEN
    RAISE EXCEPTION 'هذه الحركة ليست توريد نقدية مندوب';
  END IF;

  -- Find the matching custody line via reference embedded in notes (HND-...)
  SELECT custody_id, id INTO v_custody_id, v_line_id
  FROM public.courier_goods_custody_lines
  WHERE line_type = 'handover'
    AND notes LIKE '%' || split_part(split_part(v_txn.notes,'HND-',2),' ',1) || '%'
    AND ABS(cash_collected) = v_txn.amount
  ORDER BY performed_at DESC
  LIMIT 1;

  -- Reverse custody deduction by inserting a positive 'cash_collect' adjustment line
  IF v_custody_id IS NOT NULL THEN
    INSERT INTO public.courier_goods_custody_lines(
      custody_id, line_type, product_name, quantity, unit,
      unit_price, total_value, cash_collected,
      performed_at, performed_by, notes
    ) VALUES (
      v_custody_id, 'cash_collect', 'إلغاء توريد نقدية مرفوض', 1, 'تحويل',
      v_txn.amount, v_txn.amount, v_txn.amount,
      now(), v_user,
      'استرجاع توريد مرفوض — سبب: ' || p_reason
    );
  END IF;

  UPDATE public.main_warehouse_treasury_txns
  SET status = 'rejected',
      approved_by = v_user,
      approved_at = now(),
      rejection_reason = p_reason
  WHERE id = p_txn_id;

  BEGIN
    INSERT INTO public.notifications(user_id, type, title, message, read)
    SELECT DISTINCT user_id, 'courier_cash_handover_rejected',
      'تم رفض توريد نقدية',
      'رُفض توريد ' || v_txn.amount::text || ' ج.م من المندوب ' || COALESCE(v_txn.courier_name,'') || ' — ' || p_reason,
      false
    FROM public.user_roles
    WHERE role IN ('warehouse_manager','warehouse_supervisor');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'txn_id', p_txn_id, 'restored_to_custody', v_custody_id IS NOT NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_courier_cash_handover(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_courier_cash_handover(uuid, text) TO authenticated;
