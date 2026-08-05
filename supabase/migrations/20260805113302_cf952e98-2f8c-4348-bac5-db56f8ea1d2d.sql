CREATE OR REPLACE FUNCTION public.confirm_transfer_receipt(p_transfer_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      VALUES(
        v_li.destination_item_id,
        v_t.destination_warehouse_id,
        'in',
        v_rq,
        v_li.unit_cost,
        v_uid,
        'استلام تحويل ('||v_t.transfer_no||')'||CASE WHEN v_rq<>v_li.sent_qty THEN ' — مستلم '||v_rq||' من '||v_li.sent_qty ELSE '' END,
        v_t.transfer_no,
        'مصنع اللحوم',
        'warehouse_transfer',
        v_t.id::text
      ) RETURNING id INTO v_dest_mv_id;
    END IF;
    v_line_status:=CASE WHEN v_rq=0 THEN 'rejected' WHEN v_rq=v_li.sent_qty THEN 'received' ELSE 'partial' END;
    UPDATE public.warehouse_transfer_items SET received_qty=v_rq,receive_notes=NULLIF(v_line->>'notes',''),destination_movement_id=COALESCE(destination_movement_id,v_dest_mv_id),line_status=v_line_status WHERE id=v_li.id;
  END LOOP;
  SELECT COALESCE(SUM(sent_qty),0),COALESCE(SUM(received_qty),0) INTO v_total_sent,v_total_recv FROM public.warehouse_transfer_items WHERE transfer_id=p_transfer_id;
  v_new_status:=CASE WHEN v_total_recv=v_total_sent THEN 'received' WHEN v_total_recv=0 THEN 'pending_receipt' ELSE 'partially_received' END;
  UPDATE public.warehouse_transfers SET status=v_new_status,received_by=v_uid,received_at=now(),notes=COALESCE(p_notes,notes),audit_log=COALESCE(audit_log,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('event','receipt_confirmed','by',v_uid,'at',now(),'total_sent',v_total_sent,'total_received',v_total_recv,'status',v_new_status,'legacy_dual_post',v_t.legacy_dual_post)) WHERE id=p_transfer_id;
  RETURN jsonb_build_object('ok',true,'status',v_new_status,'total_sent',v_total_sent,'total_received',v_total_recv);
END;
$function$;