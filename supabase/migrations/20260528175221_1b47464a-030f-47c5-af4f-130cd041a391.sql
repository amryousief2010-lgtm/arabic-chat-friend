-- 1) Widen line_status CHECK to include approval workflow statuses
ALTER TABLE public.warehouse_transfer_items
  DROP CONSTRAINT IF EXISTS warehouse_transfer_items_line_status_check;
ALTER TABLE public.warehouse_transfer_items
  ADD CONSTRAINT warehouse_transfer_items_line_status_check
  CHECK (line_status = ANY (ARRAY[
    'pending','pending_approval','approved','received','partial','rejected'
  ]));

-- 2) Extend RPC to also notify Hadi after the transfer request is created
CREATE OR REPLACE FUNCTION public.request_warehouse_transfer(
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_transfer_id uuid;
  v_transfer_no text;
  v_line jsonb;
  v_src_item record;
  v_qty numeric;
  v_lines_created int := 0;
  v_dest_name text;
  v_src_name text;
  v_hadi_id uuid;
  v_supervisor_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF p_source_warehouse_id = p_destination_warehouse_id THEN
    RAISE EXCEPTION 'same_warehouse';
  END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'no_lines';
  END IF;

  v_transfer_no := public.gen_transfer_no();

  INSERT INTO public.warehouse_transfers(
    transfer_no, source_warehouse_id, destination_warehouse_id,
    status, created_by, notes, legacy_dual_post, audit_log
  ) VALUES (
    v_transfer_no, p_source_warehouse_id, p_destination_warehouse_id,
    'pending_approval', v_uid, p_notes, false,
    jsonb_build_array(jsonb_build_object('event','requested','by',v_uid,'at',now()))
  ) RETURNING id INTO v_transfer_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (v_line->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_src_item FROM public.inventory_items
      WHERE id = (v_line->>'source_item_id')::uuid
        AND warehouse_id = p_source_warehouse_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'source_item_not_found: %', v_line->>'source_item_id';
    END IF;

    INSERT INTO public.warehouse_transfer_items(
      transfer_id, source_item_id, item_name, unit,
      requested_qty, unit_cost, total_cost, line_status
    ) VALUES (
      v_transfer_id, v_src_item.id, v_src_item.name, v_src_item.unit,
      v_qty, v_src_item.unit_cost, v_qty * COALESCE(v_src_item.unit_cost, 0),
      'pending_approval'
    );
    v_lines_created := v_lines_created + 1;
  END LOOP;

  -- اسم المخزن المصدر والوجهة لاستخدامها في الإشعار
  SELECT name INTO v_dest_name FROM public.warehouses WHERE id = p_destination_warehouse_id;
  SELECT name INTO v_src_name  FROM public.warehouses WHERE id = p_source_warehouse_id;

  -- إشعار لـ عبدالهادي علي (مسؤول المخازن) ليوافق ويجهز النقل لمخزن العجوزة
  SELECT id INTO v_hadi_id FROM public.profiles WHERE email = 'abdelhady.ali@coceg.net' LIMIT 1;
  IF v_hadi_id IS NOT NULL THEN
    INSERT INTO public.notifications(title, description, type, target_user_id)
    VALUES (
      'طلب توريد جديد — ' || v_transfer_no,
      'يوجد طلب توريد بانتظار موافقتك من ' || COALESCE(v_src_name,'المخزن الرئيسي') ||
      ' إلى ' || COALESCE(v_dest_name,'العجوزة') || ' (' || v_lines_created || ' صنف).',
      'warehouse_transfer',
      v_hadi_id
    );
  END IF;

  -- وأيضاً إشعار لكل مشرفي المخازن (لو فيه غير هادي)
  FOR v_supervisor_id IN
    SELECT ur.user_id FROM public.user_roles ur
     WHERE ur.role = 'warehouse_supervisor'::app_role
       AND (v_hadi_id IS NULL OR ur.user_id <> v_hadi_id)
  LOOP
    INSERT INTO public.notifications(title, description, type, target_user_id)
    VALUES (
      'طلب توريد جديد — ' || v_transfer_no,
      'يوجد طلب توريد بانتظار الموافقة من ' || COALESCE(v_src_name,'المخزن الرئيسي') ||
      ' إلى ' || COALESCE(v_dest_name,'العجوزة') || ' (' || v_lines_created || ' صنف).',
      'warehouse_transfer',
      v_supervisor_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'transfer_id', v_transfer_id,
    'transfer_no', v_transfer_no,
    'lines', v_lines_created
  );
END;
$function$;