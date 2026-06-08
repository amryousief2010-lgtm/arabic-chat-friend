
-- =========================================================
-- Duplicate detection + safe reversal for lab_treasury
-- =========================================================

-- 1) Potential duplicates view (pairs only, status=approved, exclude already-reversed pairs)
CREATE OR REPLACE VIEW public.v_lab_treasury_potential_duplicates
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    id,
    movement_type,
    amount,
    payment_method,
    movement_date,
    COALESCE(NULLIF(TRIM(customer_name),''), NULLIF(TRIM(beneficiary),''), '') AS party,
    income_category,
    expense_category,
    source_table,
    source_id,
    status,
    created_at,
    created_by,
    description
  FROM public.lab_treasury_movements
  WHERE status = 'approved'
    AND (source_table IS NULL OR source_table NOT IN ('duplicate_reversal'))
)
SELECT
  a.id           AS first_id,
  b.id           AS duplicate_id,
  a.movement_type,
  a.amount,
  a.payment_method,
  a.movement_date,
  a.party,
  COALESCE(a.income_category::text, a.expense_category::text) AS category,
  a.source_table AS first_source_table,
  b.source_table AS duplicate_source_table,
  a.created_at   AS first_created_at,
  b.created_at   AS duplicate_created_at,
  a.created_by   AS first_created_by,
  b.created_by   AS duplicate_created_by,
  a.description  AS first_description,
  b.description  AS duplicate_description
FROM base a
JOIN base b
  ON a.movement_type = b.movement_type
 AND a.amount        = b.amount
 AND a.payment_method = b.payment_method
 AND a.movement_date = b.movement_date
 AND a.party         = b.party
 AND a.created_at    < b.created_at
WHERE NOT EXISTS (
  -- already reversed?
  SELECT 1 FROM public.lab_treasury_movements r
  WHERE r.source_table = 'duplicate_reversal' AND r.source_id = b.id
);

GRANT SELECT ON public.v_lab_treasury_potential_duplicates TO authenticated;

-- 2) RPC: reverse the effect of a duplicate (manager only)
CREATE OR REPLACE FUNCTION public.lab_treasury_reverse_duplicate(
  p_duplicate_id uuid,
  p_kept_id uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dup public.lab_treasury_movements;
  v_kept public.lab_treasury_movements;
  v_rev_id uuid;
  v_new_type public.lab_treasury_movement_type;
  v_desc text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT (has_role(v_uid,'general_manager'::app_role) OR has_role(v_uid,'executive_manager'::app_role)) THEN
    RAISE EXCEPTION 'صلاحية المدير العام/التنفيذي فقط';
  END IF;
  IF COALESCE(TRIM(p_reason),'') = '' OR length(TRIM(p_reason)) < 3 THEN
    RAISE EXCEPTION 'سبب التصحيح إلزامي (3 أحرف على الأقل)';
  END IF;

  SELECT * INTO v_dup  FROM public.lab_treasury_movements WHERE id = p_duplicate_id FOR UPDATE;
  SELECT * INTO v_kept FROM public.lab_treasury_movements WHERE id = p_kept_id;
  IF v_dup.id IS NULL THEN RAISE EXCEPTION 'الحركة المكررة غير موجودة'; END IF;
  IF v_kept.id IS NULL THEN RAISE EXCEPTION 'الحركة المعتمدة غير موجودة'; END IF;
  IF v_dup.id = v_kept.id THEN RAISE EXCEPTION 'يجب اختيار حركتين مختلفتين'; END IF;
  IF v_dup.status <> 'approved' THEN RAISE EXCEPTION 'الحركة المكررة ليست معتمدة (الحالة: %)', v_dup.status; END IF;

  -- safety: same type / amount / method / date / party
  IF v_dup.movement_type <> v_kept.movement_type
     OR v_dup.amount <> v_kept.amount
     OR v_dup.payment_method <> v_kept.payment_method
     OR v_dup.movement_date <> v_kept.movement_date THEN
    RAISE EXCEPTION 'الحركتان غير متطابقتين — لا يمكن اعتبارهما تكرار';
  END IF;
  IF COALESCE(v_dup.customer_name, v_dup.beneficiary,'') IS DISTINCT FROM COALESCE(v_kept.customer_name, v_kept.beneficiary,'') THEN
    RAISE EXCEPTION 'الحركتان لجهات مختلفة — لا يمكن اعتبارهما تكرار';
  END IF;

  -- check we didn't already reverse it
  IF EXISTS (SELECT 1 FROM public.lab_treasury_movements
             WHERE source_table = 'duplicate_reversal' AND source_id = p_duplicate_id) THEN
    RAISE EXCEPTION 'تم إلغاء أثر هذه الحركة مسبقاً';
  END IF;

  -- offsetting movement: opposite type
  IF v_dup.movement_type = 'income' THEN
    v_new_type := 'expense';
    v_desc := 'إلغاء أثر حركة إيراد مكررة #' || substr(p_duplicate_id::text,1,8) || ' — الحركة المعتمدة #' || substr(p_kept_id::text,1,8);
    INSERT INTO public.lab_treasury_movements(
      movement_type, movement_date, expense_category, amount, payment_method,
      description, notes, status, created_by, approved_by, approved_at,
      source_table, source_id, source_ref
    ) VALUES (
      v_new_type, (now() AT TIME ZONE 'Africa/Cairo')::date,
      'other'::public.lab_treasury_expense_category, v_dup.amount, v_dup.payment_method,
      v_desc, 'سبب: ' || p_reason, 'approved', v_uid, v_uid, now(),
      'duplicate_reversal', p_duplicate_id, 'reversal'
    ) RETURNING id INTO v_rev_id;
  ELSE
    v_new_type := 'income';
    v_desc := 'إلغاء أثر حركة مصروف مكررة #' || substr(p_duplicate_id::text,1,8) || ' — الحركة المعتمدة #' || substr(p_kept_id::text,1,8);
    INSERT INTO public.lab_treasury_movements(
      movement_type, movement_date, income_category, amount, payment_method,
      description, notes, status, created_by, approved_by, approved_at,
      source_table, source_id, source_ref
    ) VALUES (
      v_new_type, (now() AT TIME ZONE 'Africa/Cairo')::date,
      'other'::public.lab_treasury_income_category, v_dup.amount, v_dup.payment_method,
      v_desc, 'سبب: ' || p_reason, 'approved', v_uid, v_uid, now(),
      'duplicate_reversal', p_duplicate_id, 'reversal'
    ) RETURNING id INTO v_rev_id;
  END IF;

  INSERT INTO public.lab_treasury_audit_log(action, movement_id, actor_id, reason, before_data, after_data, metadata)
  VALUES (
    'duplicate_reversal', v_rev_id, v_uid, p_reason,
    to_jsonb(v_dup),
    to_jsonb(v_kept),
    jsonb_build_object('duplicate_id', p_duplicate_id, 'kept_id', p_kept_id, 'reversal_movement_id', v_rev_id)
  );

  RETURN v_rev_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lab_treasury_reverse_duplicate(uuid,uuid,text) TO authenticated;
