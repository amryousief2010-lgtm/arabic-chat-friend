
CREATE OR REPLACE FUNCTION public.reverse_receipt_approval(
  p_kind text,
  p_ref_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_ref_no text;
  v_reversed int := 0;
  m record;
  o record;
  t record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT (
    has_role(v_uid, 'general_manager'::app_role)
    OR has_role(v_uid, 'executive_manager'::app_role)
    OR has_role(v_uid, 'warehouse_supervisor'::app_role)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_uid;

  IF p_kind = 'meat_factory' THEN
    SELECT * INTO t FROM public.meat_production_transfers WHERE id = p_ref_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
    IF t.status NOT IN ('received','partial') THEN
      RAISE EXCEPTION 'not_received_yet'; 
    END IF;
    v_ref_no := t.transfer_no;

    -- Reverse every inventory movement created by the approval
    FOR m IN
      SELECT * FROM public.inventory_movements
       WHERE reference_type = 'meat_production_transfer'
         AND reference_id   = t.id::text
         AND approval_status <> 'reversed'
    LOOP
      UPDATE public.inventory_items
         SET stock = COALESCE(stock,0) - COALESCE(m.quantity,0),
             updated_at = now()
       WHERE id = m.item_id;
      UPDATE public.inventory_movements
         SET approval_status = 'reversed',
             notes = COALESCE(notes,'') || E'\n[عكس اعتماد الاستلام: ' || p_reason || ']'
       WHERE id = m.id;
      v_reversed := v_reversed + 1;
    END LOOP;

    UPDATE public.meat_production_transfers
       SET status = 'received_previously',
           notes  = COALESCE(notes,'') || E'\n[عُكس اعتماد الاستلام واعتُبرت موردة سابقًا: ' || p_reason || ']'
     WHERE id = t.id;

  ELSIF p_kind = 'slaughter' THEN
    SELECT batch_number INTO v_ref_no FROM public.slaughter_batches WHERE id = p_ref_id;

    FOR o IN
      SELECT * FROM public.slaughter_batch_outputs
       WHERE batch_id = p_ref_id
         AND received_status = 'received'
      FOR UPDATE
    LOOP
      IF o.received_inventory_item_id IS NOT NULL AND COALESCE(o.actual_weight_kg,0) > 0 THEN
        UPDATE public.inventory_items
           SET stock = COALESCE(stock,0) - o.actual_weight_kg,
               updated_at = now()
         WHERE id = o.received_inventory_item_id;

        INSERT INTO public.inventory_movements
          (item_id, warehouse_id, movement_type, quantity, reference, party,
           unit_cost, performed_by, notes, approval_status)
        VALUES
          (o.received_inventory_item_id, o.received_warehouse_id, 'adjustment',
           -o.actual_weight_kg,
           'عكس استلام دفعة ذبح ' || COALESCE(v_ref_no,''),
           'المجزر', COALESCE(o.unit_cost,0), v_uid,
           '[عكس اعتماد — موردة سابقًا: ' || p_reason || ']',
           'posted');
      END IF;

      UPDATE public.slaughter_batch_outputs
         SET received_status = 'received_previously',
             received_at     = NULL,
             notes = COALESCE(notes,'') || E'\n[عُكس اعتماد الاستلام واعتُبرت موردة سابقًا: ' || p_reason || ']'
       WHERE id = o.id;
      v_reversed := v_reversed + 1;
    END LOOP;

  ELSE
    RAISE EXCEPTION 'unknown_kind: %', p_kind;
  END IF;

  INSERT INTO public.receipt_disposition_audit(kind, ref_id, ref_no, action, reason, performed_by, performed_by_name)
  VALUES (p_kind, p_ref_id, v_ref_no, 'reversed_approval', p_reason, v_uid, v_name);

  RETURN jsonb_build_object('success', true, 'reversed', v_reversed);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reverse_receipt_approval(text, uuid, text) TO authenticated;
