-- نقل مخرجات المجزر مباشرة إلى مصنع اللحوم (بدون المرور على المخزن الرئيسي)
-- 1) دالة إرسال جديدة تغيّر وجهة المخرج إلى meat_factory (مع دعم الكميات الجزئية)
-- 2) تقوية دالة الاستلام في المصنع: رفض «المورّد سابقًا» ودفعات ما قبل جرد 1 أكتوبر 2026
-- 3) منع تسجيل فاتورة شراء جديدة لمصنع اللحوم موردها «المجزر» (الفواتير القديمة لا تُمس)

CREATE OR REPLACE FUNCTION public.send_slaughter_outputs_to_meat_factory(p_batch_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  item jsonb;
  v_out public.slaughter_batch_outputs%ROWTYPE;
  v_qty numeric;
  v_count int := 0;
  v_total numeric := 0;
  v_date date;
  v_no text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'slaughterhouse_manager'::app_role,
    'production_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك بإرسال مخرجات المجزر إلى مصنع اللحوم';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'ITEMS_REQUIRED';
  END IF;

  SELECT slaughter_date, batch_number INTO v_date, v_no FROM public.slaughter_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  IF v_date IS NOT NULL AND v_date < DATE '2026-10-01'
     AND COALESCE(current_setting('app.allow_pre_stocktake_receive', true), '') <> 'on' THEN
    RAISE EXCEPTION 'PRE_STOCKTAKE_BATCH: لا يمكن إرسال الدفعة % لأن تاريخها (%) قبل جرد 1 أكتوبر 2026. الدفعات دي تعتبر موردة سابقًا.', v_no, v_date;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_out FROM public.slaughter_batch_outputs
      WHERE id = (item->>'output_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_out.batch_id <> p_batch_id THEN CONTINUE; END IF;
    IF COALESCE(v_out.received_status, 'pending') IN ('received', 'received_previously') THEN CONTINUE; END IF;
    IF COALESCE(v_out.quality_status, 'accepted') <> 'accepted' THEN CONTINUE; END IF;
    IF COALESCE(v_out.destination, '') = 'waste' THEN CONTINUE; END IF;

    v_qty := COALESCE((item->>'qty')::numeric, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;
    IF v_qty > v_out.actual_weight_kg THEN v_qty := v_out.actual_weight_kg; END IF;

    -- توريد جزئي: المتبقي يبقى بوجهته الأصلية وحالة «معلّق»
    IF v_qty < v_out.actual_weight_kg THEN
      INSERT INTO public.slaughter_batch_outputs(
        batch_id, yield_standard_id, cut_name_ar, product_id,
        actual_weight_kg, package_count, standard_weight_kg, unit_cost,
        expiry_date, destination, notes, branch_id, unit_price,
        received_status, quality_status, damaged_weight_kg, quarantined_weight_kg,
        received_warehouse_id
      ) VALUES (
        v_out.batch_id, v_out.yield_standard_id, v_out.cut_name_ar, v_out.product_id,
        v_out.actual_weight_kg - v_qty, 0, 0, v_out.unit_cost,
        v_out.expiry_date, CASE WHEN v_out.destination = 'meat_factory' THEN 'warehouse' ELSE v_out.destination END,
        COALESCE(v_out.notes, '') || ' (متبقي بعد توريد جزئي لمصنع اللحوم)',
        v_out.branch_id, v_out.unit_price,
        'pending', v_out.quality_status, 0, 0,
        NULL
      );
    END IF;

    UPDATE public.slaughter_batch_outputs
       SET actual_weight_kg = v_qty,
           destination = 'meat_factory',
           branch_id = NULL,
           received_warehouse_id = NULL,
           received_status = 'pending'
     WHERE id = v_out.id;

    INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, performed_by, new_value, notes)
    VALUES ('send_to_meat_factory', 'output', v_out.id, v_out.batch_id, auth.uid(),
            jsonb_build_object('qty', v_qty, 'previous_destination', v_out.destination),
            'إرسال مباشر إلى مصنع اللحوم: ' || v_out.cut_name_ar || ' — ' || v_qty || ' كجم');

    v_count := v_count + 1;
    v_total := v_total + v_qty;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'NOTHING_TO_SEND: لا توجد أصناف صالحة للإرسال إلى مصنع اللحوم في هذه الدفعة';
  END IF;

  RETURN jsonb_build_object('success', true, 'sent_count', v_count, 'total_kg', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.send_slaughter_outputs_to_meat_factory(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_slaughter_outputs_to_meat_factory(uuid, jsonb) TO authenticated, service_role;

-- استلام المصنع: نفس منطق الدالة الحالية + حماية «مورّد سابقًا» وما قبل الجرد
CREATE OR REPLACE FUNCTION public.receive_slaughter_output_to_meat_factory(p_output_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out public.slaughter_batch_outputs%ROWTYPE;
  v_uid uuid := auth.uid();
  v_item_id uuid;
  v_old_stock numeric := 0;
  v_old_cost numeric := 0;
  v_new_stock numeric;
  v_new_cost numeric;
  v_qty numeric;
  v_cost numeric;
  v_batch_no text;
  v_date date;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'meat_factory_manager'::app_role,
    'production_manager'::app_role,
    'warehouse_supervisor'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك باستلام مخرجات المجزر إلى مصنع اللحوم';
  END IF;

  SELECT * INTO v_out FROM public.slaughter_batch_outputs WHERE id = p_output_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTPUT_NOT_FOUND'; END IF;
  IF v_out.destination <> 'meat_factory' THEN
    RAISE EXCEPTION 'INVALID_DESTINATION: المخرج ليس موجها إلى مصنع اللحوم';
  END IF;
  IF v_out.received_status IN ('received', 'received_previously') THEN
    RAISE EXCEPTION 'ALREADY_RECEIVED: تم تسجيل هذا التحويل إلى مصنع اللحوم من قبل';
  END IF;

  SELECT batch_number, slaughter_date INTO v_batch_no, v_date FROM public.slaughter_batches WHERE id = v_out.batch_id;
  IF v_date IS NOT NULL AND v_date < DATE '2026-10-01'
     AND COALESCE(current_setting('app.allow_pre_stocktake_receive', true), '') <> 'on' THEN
    RAISE EXCEPTION 'PRE_STOCKTAKE_BATCH: لا يمكن استلام الدفعة % لأن تاريخها (%) قبل جرد 1 أكتوبر 2026.', v_batch_no, v_date;
  END IF;

  IF v_out.quality_status <> 'accepted' THEN
    UPDATE public.slaughter_batch_outputs
      SET received_status = 'received', received_at = now(), received_by = v_uid
      WHERE id = p_output_id;
    RETURN jsonb_build_object('success', true, 'added_to_stock', false, 'reason', 'non_accepted_quality');
  END IF;

  v_qty := COALESCE(v_out.actual_weight_kg, 0);
  v_cost := COALESCE(v_out.unit_cost, 0);

  SELECT id, current_stock, avg_cost INTO v_item_id, v_old_stock, v_old_cost
  FROM public.meat_factory_raw_items
  WHERE name = v_out.cut_name_ar AND kind = 'raw'
  LIMIT 1;

  IF v_item_id IS NULL THEN
    INSERT INTO public.meat_factory_raw_items (name, kind, unit, current_stock, avg_cost, low_stock_threshold)
    VALUES (v_out.cut_name_ar, 'raw', 'كجم', 0, 0, 5)
    RETURNING id, current_stock, avg_cost INTO v_item_id, v_old_stock, v_old_cost;
  END IF;
  v_old_stock := COALESCE(v_old_stock, 0);
  v_old_cost := COALESCE(v_old_cost, 0);

  IF (v_old_stock + v_qty) > 0 THEN
    v_new_cost := ((v_old_stock * v_old_cost) + (v_qty * v_cost)) / (v_old_stock + v_qty);
  ELSE
    v_new_cost := v_cost;
  END IF;
  v_new_stock := v_old_stock + v_qty;

  PERFORM public.post_meat_raw_movement(
    v_item_id, 'IN', v_qty, v_cost,
    'وارد من المجزر — دفعة ' || COALESCE(v_batch_no, ''),
    'slaughter_batch_outputs', p_output_id,
    'raw', 'delta', NULL, v_new_cost, v_out.cut_name_ar
  );

  UPDATE public.slaughter_batch_outputs
    SET received_status = 'received',
        received_at = now(),
        received_by = v_uid,
        received_warehouse_id = NULL
    WHERE id = p_output_id;

  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES
    ('meat_factory_receipt', 'output', p_output_id, v_out.batch_id, v_uid,
     jsonb_build_object('item_id', v_item_id, 'qty', v_qty, 'unit_cost', v_cost,
                        'stock_before', v_old_stock, 'stock_after', v_new_stock),
     'استلام في مصنع اللحوم: ' || v_out.cut_name_ar || ' — ' || v_qty || ' كجم');

  RETURN jsonb_build_object(
    'success', true, 'added_to_stock', true, 'item_id', v_item_id,
    'item_name', v_out.cut_name_ar, 'qty', v_qty,
    'stock_before', v_old_stock, 'stock_after', v_new_stock, 'avg_cost', v_new_cost
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_RECEIVED: تم تسجيل هذا التحويل إلى مصنع اللحوم من قبل';
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_slaughter_output_to_meat_factory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_slaughter_output_to_meat_factory(uuid) TO authenticated, service_role;

-- منع فاتورة شراء جديدة (أو تغيير المورد) إلى «المجزر» في مصنع اللحوم
CREATE OR REPLACE FUNCTION public.block_slaughterhouse_supplier_on_meat_purchase()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_norm text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.supplier IS NOT DISTINCT FROM OLD.supplier THEN
    RETURN NEW;
  END IF;
  v_norm := regexp_replace(translate(COALESCE(NEW.supplier, ''), 'أإآة', 'اااه'), '[\s\u064B-\u0652\u0640]+', '', 'g');
  IF v_norm ~ 'مجزر' OR lower(v_norm) ~ 'slaughter' THEN
    RAISE EXCEPTION 'SLAUGHTERHOUSE_SUPPLIER: المجزر قسم داخلي وليس موردًا. أرسل اللحم من شاشة المجزر بوجهة «مصنع اللحوم» واستلمه من «وارد المجزر» في مصنع اللحوم.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_slaughterhouse_supplier_on_meat_purchase ON public.meat_factory_purchases;
CREATE TRIGGER trg_block_slaughterhouse_supplier_on_meat_purchase
BEFORE INSERT OR UPDATE OF supplier ON public.meat_factory_purchases
FOR EACH ROW EXECUTE FUNCTION public.block_slaughterhouse_supplier_on_meat_purchase();
