-- Transfer document key. The screen mints one UUID when the form opens and
-- sends it again on retry. The same key is the source_id of both legs, so a
-- second call returns the existing transfer and does not move stock again.

DROP FUNCTION IF EXISTS public.inv_transfer(uuid, uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.inv_transfer(
  p_source_item_id uuid,
  p_destination_warehouse_id uuid,
  p_quantity numeric,
  p_reason text,
  p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_src public.inventory_items%ROWTYPE;
  v_dest_item_id uuid;
  v_uid uuid := auth.uid();
  v_doc uuid := COALESCE(p_request_id, gen_random_uuid());
  v_out jsonb;
  v_in jsonb;
  v_status text;
BEGIN
  IF NOT public.can_post_inventory(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: السبب مطلوب';
  END IF;
  SELECT * INTO v_src FROM public.inventory_items WHERE id = p_source_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_NOT_FOUND'; END IF;
  IF v_src.warehouse_id = p_destination_warehouse_id THEN RAISE EXCEPTION 'SAME_WAREHOUSE'; END IF;

  SELECT m.item_id INTO v_dest_item_id
    FROM public.inventory_movements m
   WHERE m.source_type = 'transfer_in'
     AND m.source_id = v_doc
     AND m.source_line_id = 'in'
     AND COALESCE(m.approval_status, 'posted') = 'posted'
   LIMIT 1;

  IF v_dest_item_id IS NULL THEN
    SELECT id INTO v_dest_item_id FROM public.inventory_items
     WHERE warehouse_id = p_destination_warehouse_id AND name = v_src.name
     ORDER BY id LIMIT 1;
  END IF;
  IF v_dest_item_id IS NULL THEN
    INSERT INTO public.inventory_items(
      warehouse_id, name, category, unit, stock, unit_cost, low_stock_threshold, module, item_code
    ) VALUES (
      p_destination_warehouse_id, v_src.name, v_src.category, v_src.unit, 0, v_src.unit_cost,
      v_src.low_stock_threshold, v_src.module, v_src.item_code
    ) RETURNING id INTO v_dest_item_id;
  END IF;

  PERFORM set_config('app.inventory_internal_post', 'on', true);
  v_out := public.post_inventory_movement(
    p_source_item_id, 'transfer', p_quantity, 'transfer_out', v_doc, 'out',
    btrim(p_reason), NULL, now(), v_src.unit_cost, NULL, NULL, 'delta', false,
    v_src.warehouse_id, v_src.product_id, v_src.module, NULL, NULL, 'transfer_out', v_doc::text,
    p_destination_warehouse_id, NULL, NULL, NULL
  );
  v_in := public.post_inventory_movement(
    v_dest_item_id, 'in', p_quantity, 'transfer_in', v_doc, 'in',
    btrim(p_reason), NULL, now(), v_src.unit_cost, NULL, NULL, 'delta', false,
    p_destination_warehouse_id, NULL, v_src.module, NULL, NULL, 'transfer_in', v_doc::text,
    NULL, NULL, NULL, NULL
  );
  PERFORM set_config('app.inventory_internal_post', 'off', true);

  v_status := CASE
    WHEN v_out->>'status' = 'already_posted' AND v_in->>'status' = 'already_posted' THEN 'already_posted'
    ELSE 'posted'
  END;
  RETURN jsonb_build_object(
    'success', true,
    'status', v_status,
    'destination_item_id', v_dest_item_id,
    'source_id', v_doc
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inv_transfer(uuid, uuid, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_transfer(uuid, uuid, numeric, text, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.inv_transfer(uuid, uuid, numeric, text, uuid) IS
  'تحويل بين مخزنين. p_request_id مفتاح المستند الذي تولّده الشاشة مرة عند فتح النموذج. إعادة نفس المفتاح تعيد التحويل القائم ولا تنشئ حركة ثانية.';
