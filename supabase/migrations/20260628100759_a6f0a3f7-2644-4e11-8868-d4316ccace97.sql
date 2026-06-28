CREATE OR REPLACE FUNCTION public.record_courier_delivery_and_collection(
  p_assignment_id  uuid,
  p_amount_collected numeric DEFAULT NULL,  -- NULL = استلام بدون تحصيل، 0 = آجل، >0 = تحصيل جزئي/كامل
  p_notes          text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_asn RECORD;
  v_order RECORD;
  v_courier text;
  v_custody_id uuid;
  v_due numeric;
  v_amt numeric;
  v_collection_status text;
  v_assignment_status text;
  v_tracking_status text;
  v_reference text;
  v_existing_line_id uuid;
  v_line_id uuid;
BEGIN
  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'assignment_id is required';
  END IF;

  -- Lock the assignment row
  SELECT a.id, a.custody_id, a.order_id, a.courier_name, a.status
    INTO v_asn
  FROM public.courier_order_assignments a
  WHERE a.id = p_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'التعيين غير موجود';
  END IF;
  IF v_asn.status IN ('fully_returned','cancelled') THEN
    RAISE EXCEPTION 'الأوردر مرتجع/ملغي ولا يمكن تسجيل تسليم له';
  END IF;

  v_courier    := v_asn.courier_name;
  v_custody_id := v_asn.custody_id;

  -- Lock the order row
  SELECT o.id, o.order_number, o.customer_id, o.total, o.status
    INTO v_order
  FROM public.orders o
  WHERE o.id = v_asn.order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الأوردر غير موجود'; END IF;

  v_due := COALESCE(v_order.total, 0);
  v_amt := COALESCE(p_amount_collected, 0);
  IF v_amt < 0 THEN RAISE EXCEPTION 'مبلغ غير صالح'; END IF;

  v_reference := 'DELIV-' || COALESCE(NULLIF(p_idempotency_key,''),
                  to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS') || '-' || substr(v_asn.id::text,1,6));

  -- Idempotency: did we already log a sale-line for this assignment with same reference?
  SELECT id INTO v_existing_line_id
  FROM public.courier_goods_custody_lines
  WHERE order_id = v_asn.order_id
    AND line_type = 'sale'
    AND notes LIKE '%' || v_reference || '%'
  LIMIT 1;

  IF v_existing_line_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reference', v_reference,
      'line_id', v_existing_line_id,
      'idempotent_hit', true
    );
  END IF;

  -- Decide statuses
  IF v_amt = 0 THEN
    v_collection_status := 'not_collected';
    v_assignment_status := 'delivered';
    v_tracking_status   := 'delivered';
  ELSIF v_amt < v_due THEN
    v_collection_status := 'partial_collected';
    v_assignment_status := 'delivered';   -- delivered but cash partial
    v_tracking_status   := 'delivered';
  ELSE
    v_collection_status := 'cash_collected';
    v_assignment_status := 'completed';
    v_tracking_status   := 'collected';
  END IF;

  -- 1) Sale line on courier custody (carries cash_collected for reconciliation)
  INSERT INTO public.courier_goods_custody_lines(
    custody_id, line_type, customer_id, customer_name, order_id,
    product_name, quantity, unit, unit_price, total_value, cash_collected,
    performed_at, performed_by, notes
  )
  SELECT
    v_custody_id, 'sale', v_order.customer_id, c.name, v_order.id,
    'أوردر ' || COALESCE(v_order.order_number,''), 1, 'أوردر', v_due, v_due, v_amt,
    now(), v_user,
    'تسليم وتحصيل — ' || v_reference || COALESCE(' | ' || NULLIF(p_notes,''), '')
  FROM (SELECT 1) x
  LEFT JOIN public.customers c ON c.id = v_order.customer_id
  RETURNING id INTO v_line_id;

  -- 2) pc_collections upsert
  INSERT INTO public.pc_collections(
    order_id, amount_due, amount_collected, status, notes, collected_at, collected_by
  ) VALUES (
    v_order.id, v_due, v_amt, v_collection_status::pc_collection_status,
    p_notes, now(), v_user
  )
  ON CONFLICT (order_id) DO UPDATE SET
    amount_due = EXCLUDED.amount_due,
    amount_collected = EXCLUDED.amount_collected,
    status = EXCLUDED.status,
    notes = COALESCE(EXCLUDED.notes, public.pc_collections.notes),
    collected_at = EXCLUDED.collected_at,
    collected_by = EXCLUDED.collected_by,
    updated_at = now();

  -- 3) Assignment
  UPDATE public.courier_order_assignments
     SET status = v_assignment_status,
         delivered_at = COALESCE(delivered_at, now()),
         collected_at = CASE WHEN v_amt >= v_due THEN now() ELSE collected_at END,
         notes = COALESCE(NULLIF(p_notes,''), notes),
         updated_at = now()
   WHERE id = p_assignment_id;

  -- 4) Tracking
  INSERT INTO public.pc_order_tracking(order_id, courier_status, delivered_at, last_updated_by)
  VALUES (v_order.id, v_tracking_status::courier_status, now(), v_user)
  ON CONFLICT (order_id) DO UPDATE SET
    courier_status = EXCLUDED.courier_status,
    delivered_at = COALESCE(public.pc_order_tracking.delivered_at, EXCLUDED.delivered_at),
    last_updated_by = EXCLUDED.last_updated_by,
    updated_at = now();

  -- 5) Order status → delivered
  UPDATE public.orders
     SET status = 'delivered',
         delivered_at = COALESCE(delivered_at, now()),
         delivered_by = COALESCE(delivered_by, v_user),
         total_at_delivery = COALESCE(total_at_delivery, v_due),
         updated_at = now()
   WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'reference', v_reference,
    'line_id', v_line_id,
    'assignment_status', v_assignment_status,
    'collection_status', v_collection_status,
    'amount_collected', v_amt,
    'amount_due', v_due,
    'idempotent_hit', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_courier_delivery_and_collection(uuid, numeric, text, text) TO authenticated;