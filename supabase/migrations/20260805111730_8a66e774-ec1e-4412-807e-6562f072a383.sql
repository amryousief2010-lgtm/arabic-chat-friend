CREATE OR REPLACE FUNCTION public.resolve_inventory_transfer_destination(
  p_source_item_id uuid,
  p_destination_warehouse_id uuid
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_source public.inventory_items%ROWTYPE;
  v_dest uuid;
  v_key text;
  v_alias text;
BEGIN
  SELECT * INTO v_source
  FROM public.inventory_items
  WHERE id = p_source_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_source.product_id IS NOT NULL THEN
    SELECT id INTO v_dest
    FROM public.inventory_items
    WHERE warehouse_id = p_destination_warehouse_id
      AND product_id = v_source.product_id
      AND is_active = true
    ORDER BY updated_at DESC
    LIMIT 1;
    IF v_dest IS NOT NULL THEN RETURN v_dest; END IF;
  END IF;

  IF NULLIF(btrim(v_source.item_code), '') IS NOT NULL THEN
    SELECT i.id INTO v_dest
    FROM public.inventory_items i
    LEFT JOIN public.products p ON p.id = i.product_id
    WHERE i.warehouse_id = p_destination_warehouse_id
      AND i.is_active = true
      AND (i.item_code = v_source.item_code OR p.barcode = v_source.item_code)
    ORDER BY (i.product_id IS NOT NULL) DESC, i.updated_at DESC
    LIMIT 1;
    IF v_dest IS NOT NULL THEN RETURN v_dest; END IF;
  END IF;

  v_key := btrim(public.normalize_ar_name(v_source.name));
  v_key := btrim(regexp_replace(v_key, '(^| )(نعام|نعامه)( |$)', ' ', 'g'));
  v_key := btrim(regexp_replace(v_key, '\s+', ' ', 'g'));
  v_alias := CASE
    WHEN v_key IN ('كفته رز','كفته الرز','كفتة رز','كفتة الرز') THEN 'كفته الرز'
    WHEN v_key IN ('كباب','كباب قطع') THEN 'قطع كباب'
    WHEN v_key IN ('كفته','كفتة') THEN 'كفته'
    WHEN v_key = 'برجر' THEN 'برجر'
    WHEN v_key = 'سجق' THEN 'سجق'
    WHEN v_key = 'حواوشي' THEN 'حواوشي'
    WHEN v_key = 'شاورما' THEN 'شاورما'
    ELSE v_key
  END;

  SELECT i.id INTO v_dest
  FROM public.inventory_items i
  LEFT JOIN public.products p ON p.id = i.product_id
  WHERE i.warehouse_id = p_destination_warehouse_id
    AND i.is_active = true
    AND (
      btrim(public.normalize_ar_name(i.name)) = v_alias
      OR btrim(public.normalize_ar_name(p.name)) = v_alias
    )
  ORDER BY (i.product_id IS NOT NULL) DESC, i.updated_at DESC
  LIMIT 1;

  RETURN v_dest;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_inventory_transfer_destination(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_inventory_transfer_destination(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_and_send_transfer(p_source_warehouse_id uuid, p_destination_warehouse_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_transfer_id uuid; v_transfer_no text; v_line jsonb;
  v_src_item public.inventory_items%ROWTYPE; v_dest_item public.inventory_items%ROWTYPE;
  v_qty numeric; v_src_mv_id uuid; v_lines_created int := 0; v_src_wh_name text; v_party text; v_dest_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (public.has_role(v_uid,'general_manager') OR public.has_role(v_uid,'executive_manager') OR public.has_role(v_uid,'warehouse_supervisor') OR public.has_role(v_uid,'meat_factory_manager') OR public.has_role(v_uid,'production_manager')) THEN RAISE EXCEPTION 'insufficient_privilege'; END IF;
  IF p_source_warehouse_id = p_destination_warehouse_id THEN RAISE EXCEPTION 'same_warehouse'; END IF;
  IF jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'no_lines'; END IF;
  SELECT name INTO v_src_wh_name FROM public.warehouses WHERE id=p_source_warehouse_id;
  v_party := CASE WHEN v_src_wh_name ILIKE '%مصنع اللحوم%' THEN 'مصنع اللحوم' WHEN v_src_wh_name ILIKE '%مصنع العلف%' THEN 'مصنع العلف' WHEN v_src_wh_name ILIKE '%مجزر%' THEN 'المجزر' ELSE v_src_wh_name END;
  v_transfer_no := public.gen_transfer_no();
  INSERT INTO public.warehouse_transfers(transfer_no,source_warehouse_id,destination_warehouse_id,status,created_by,sent_by,sent_at,notes,legacy_dual_post,audit_log)
  VALUES(v_transfer_no,p_source_warehouse_id,p_destination_warehouse_id,'pending_receipt',v_uid,v_uid,now(),p_notes,false,jsonb_build_array(jsonb_build_object('event','created_and_sent','by',v_uid,'at',now()))) RETURNING id INTO v_transfer_id;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (v_line->>'qty')::numeric; IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO v_src_item FROM public.inventory_items WHERE id=(v_line->>'source_item_id')::uuid AND warehouse_id=p_source_warehouse_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'source_item_not_found: %',v_line->>'source_item_id'; END IF;
    IF v_src_item.stock < v_qty THEN RAISE EXCEPTION 'insufficient_stock: % (have %, need %)',v_src_item.name,v_src_item.stock,v_qty; END IF;
    v_dest_id := public.resolve_inventory_transfer_destination(v_src_item.id,p_destination_warehouse_id);
    IF v_dest_id IS NULL THEN
      IF p_destination_warehouse_id='5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid AND v_party='مصنع اللحوم' THEN RAISE EXCEPTION 'destination_item_mapping_required: %',v_src_item.name; END IF;
      INSERT INTO public.inventory_items(warehouse_id,name,category,sku,unit,stock,low_stock_threshold,unit_cost,item_code,product_id,module)
      VALUES(p_destination_warehouse_id,v_src_item.name,v_src_item.category,v_src_item.sku,v_src_item.unit,0,v_src_item.low_stock_threshold,v_src_item.unit_cost,v_src_item.item_code,v_src_item.product_id,v_src_item.module) RETURNING id INTO v_dest_id;
    END IF;
    SELECT * INTO v_dest_item FROM public.inventory_items WHERE id=v_dest_id;
    INSERT INTO public.inventory_movements(item_id,warehouse_id,movement_type,quantity,destination_warehouse_id,unit_cost,performed_by,notes,reference,party)
    VALUES(v_src_item.id,p_source_warehouse_id,'transfer',v_qty,p_destination_warehouse_id,v_src_item.unit_cost,v_uid,'تحويل صادر ('||v_transfer_no||')',v_transfer_no,v_party) RETURNING id INTO v_src_mv_id;
    INSERT INTO public.warehouse_transfer_items(transfer_id,source_item_id,destination_item_id,item_name,unit,requested_qty,sent_qty,unit_cost,total_cost,source_movement_id,destination_movement_id,line_status)
    VALUES(v_transfer_id,v_src_item.id,v_dest_item.id,v_src_item.name,v_src_item.unit,v_qty,v_qty,v_src_item.unit_cost,v_qty*COALESCE(v_src_item.unit_cost,0),v_src_mv_id,NULL,'pending');
    v_lines_created := v_lines_created+1;
  END LOOP;
  IF v_lines_created=0 THEN RAISE EXCEPTION 'no_valid_lines'; END IF;
  RETURN jsonb_build_object('ok',true,'transfer_id',v_transfer_id,'transfer_no',v_transfer_no,'lines',v_lines_created);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_transfer_receipt(p_transfer_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_t public.warehouse_transfers%ROWTYPE; v_line jsonb; v_li public.warehouse_transfer_items%ROWTYPE;
  v_rq numeric; v_total_sent numeric:=0; v_total_recv numeric:=0; v_new_status text; v_dest_mv_id uuid; v_line_status text; v_resolved_dest uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_t FROM public.warehouse_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF NOT public.can_receive_warehouse_transfer(v_uid,v_t.destination_warehouse_id) THEN RAISE EXCEPTION 'insufficient_privilege_receive_transfer'; END IF;
  IF v_t.status IN ('received','partially_received') THEN RETURN jsonb_build_object('ok',true,'already_received',true,'status',v_t.status); END IF;
  IF v_t.status='cancelled' THEN RAISE EXCEPTION 'transfer_cancelled'; END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_li FROM public.warehouse_transfer_items WHERE id=(v_line->>'line_id')::uuid AND transfer_id=p_transfer_id FOR UPDATE;
    IF NOT FOUND OR v_li.line_status IN ('received','partial','rejected') THEN CONTINUE; END IF;
    v_rq:=COALESCE((v_line->>'received_qty')::numeric,v_li.sent_qty); v_rq:=GREATEST(0,LEAST(v_rq,v_li.sent_qty));
    IF v_rq<>v_li.sent_qty AND COALESCE(trim(v_line->>'notes'),'')='' THEN RAISE EXCEPTION 'notes_required_for_partial: %',v_li.item_name; END IF;
    v_resolved_dest:=public.resolve_inventory_transfer_destination(v_li.source_item_id,v_t.destination_warehouse_id);
    IF v_t.destination_warehouse_id='5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid AND v_resolved_dest IS NULL THEN RAISE EXCEPTION 'destination_item_mapping_required: %',v_li.item_name; END IF;
    IF v_resolved_dest IS NOT NULL AND v_resolved_dest<>v_li.destination_item_id THEN UPDATE public.warehouse_transfer_items SET destination_item_id=v_resolved_dest WHERE id=v_li.id; v_li.destination_item_id:=v_resolved_dest; END IF;
    v_dest_mv_id:=NULL;
    IF v_t.legacy_dual_post=false AND v_rq>0 AND v_li.destination_movement_id IS NULL THEN
      INSERT INTO public.inventory_movements(item_id,warehouse_id,movement_type,quantity,unit_cost,performed_by,notes,reference,party,reference_type,reference_id)
      VALUES(v_li.destination_item_id,v_t.destination_warehouse_id,'in',v_rq,v_li.unit_cost,v_uid,'استلام تحويل ('||v_t.transfer_no||')'||CASE WHEN v_rq<>v_li.sent_qty THEN ' — مستلم '||v_rq||' من '||v_li.sent_qty ELSE '' END,v_t.transfer_no,'مصنع اللحوم','warehouse_transfers:'||v_t.id::text) RETURNING id INTO v_dest_mv_id;
    END IF;
    v_line_status:=CASE WHEN v_rq=0 THEN 'rejected' WHEN v_rq=v_li.sent_qty THEN 'received' ELSE 'partial' END;
    UPDATE public.warehouse_transfer_items SET received_qty=v_rq,receive_notes=NULLIF(v_line->>'notes',''),destination_movement_id=COALESCE(destination_movement_id,v_dest_mv_id),line_status=v_line_status WHERE id=v_li.id;
  END LOOP;
  SELECT COALESCE(SUM(sent_qty),0),COALESCE(SUM(received_qty),0) INTO v_total_sent,v_total_recv FROM public.warehouse_transfer_items WHERE transfer_id=p_transfer_id;
  v_new_status:=CASE WHEN v_total_recv=v_total_sent THEN 'received' WHEN v_total_recv=0 THEN 'pending_receipt' ELSE 'partially_received' END;
  UPDATE public.warehouse_transfers SET status=v_new_status,received_by=v_uid,received_at=now(),notes=COALESCE(p_notes,notes),audit_log=audit_log||jsonb_build_array(jsonb_build_object('event','receipt_confirmed','by',v_uid,'at',now(),'total_sent',v_total_sent,'total_received',v_total_recv,'status',v_new_status,'legacy_dual_post',v_t.legacy_dual_post)) WHERE id=p_transfer_id;
  RETURN jsonb_build_object('ok',true,'status',v_new_status,'total_sent',v_total_sent,'total_received',v_total_recv);
END;
$$;

REVOKE ALL ON FUNCTION public.create_and_send_transfer(uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_and_send_transfer(uuid,uuid,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_transfer_receipt(uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_transfer_receipt(uuid,jsonb,text) TO authenticated;