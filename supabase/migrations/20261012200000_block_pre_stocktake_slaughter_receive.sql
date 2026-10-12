-- منع اعتماد/استلام مخرجات دفعات مجزر تاريخها قبل جرد 1 أكتوبر 2026 (إنفاذ من السيرفر)
CREATE OR REPLACE FUNCTION public.block_pre_stocktake_slaughter_receive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_date date;
  v_no text;
BEGIN
  IF COALESCE(current_setting('app.allow_pre_stocktake_receive', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.received_status = 'received'
     AND NEW.received_inventory_item_id IS NOT NULL
     AND (OLD.received_inventory_item_id IS NULL OR OLD.received_status IS DISTINCT FROM 'received') THEN
    SELECT slaughter_date, batch_number INTO v_date, v_no
    FROM public.slaughter_batches WHERE id = NEW.batch_id;
    IF v_date IS NOT NULL AND v_date < DATE '2026-10-01' THEN
      RAISE EXCEPTION 'PRE_STOCKTAKE_BATCH: لا يمكن اعتماد أو استلام الدفعة % لأن تاريخها (%) قبل جرد 1 أكتوبر 2026. الدفعات دي تعتبر موردة سابقًا ولا تدخل المخزن.', v_no, v_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_pre_stocktake_slaughter_receive ON public.slaughter_batch_outputs;
CREATE TRIGGER trg_block_pre_stocktake_slaughter_receive
BEFORE UPDATE ON public.slaughter_batch_outputs
FOR EACH ROW EXECUTE FUNCTION public.block_pre_stocktake_slaughter_receive();

-- حماية إضافية في دالة الاستلام الجماعي قبل أي حركة
CREATE OR REPLACE FUNCTION public.receive_slaughter_batch(p_batch_id uuid, p_warehouse_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_count int := 0;
  v_added int := 0;
  v_total numeric := 0;
  v_date date;
  v_no text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role,
    'slaughterhouse_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك باستلام مخرجات المجزر';
  END IF;

  SELECT slaughter_date, batch_number INTO v_date, v_no FROM public.slaughter_batches WHERE id = p_batch_id;
  IF v_date IS NOT NULL AND v_date < DATE '2026-10-01'
     AND COALESCE(current_setting('app.allow_pre_stocktake_receive', true), '') <> 'on' THEN
    RAISE EXCEPTION 'PRE_STOCKTAKE_BATCH: لا يمكن اعتماد الدفعة % لأن تاريخها (%) قبل جرد 1 أكتوبر 2026. الدفعات دي تعتبر موردة سابقًا ولا تدخل المخزن.', v_no, v_date;
  END IF;

  FOR r IN
    SELECT id, actual_weight_kg, quality_status, received_warehouse_id
    FROM public.slaughter_batch_outputs
    WHERE batch_id = p_batch_id
      AND destination IN ('warehouse','branch','meat_factory')
      AND (received_status <> 'received' OR received_inventory_item_id IS NULL)
      AND COALESCE(received_status,'pending') <> 'received_previously'
  LOOP
    PERFORM public.receive_slaughter_output(r.id, COALESCE(r.received_warehouse_id, p_warehouse_id));
    v_count := v_count + 1;
    v_total := v_total + COALESCE(r.actual_weight_kg, 0);
    IF r.quality_status = 'accepted' THEN v_added := v_added + 1; END IF;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'NOTHING_TO_RECEIVE: لا توجد أصناف بانتظار الاستلام في هذه الدفعة (تم استلامها مسبقًا أو وجهتها غير المخزن)';
  END IF;

  RETURN jsonb_build_object('success', true, 'received_count', v_count, 'added_to_stock', v_added, 'total_kg', v_total);
END;
$function$;
