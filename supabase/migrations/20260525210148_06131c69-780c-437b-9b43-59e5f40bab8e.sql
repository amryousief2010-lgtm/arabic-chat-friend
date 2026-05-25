DO $$
DECLARE
  v_src record;
  v_dest record;
  v_transfer_id uuid;
  v_transfer_no text;
  v_src_item public.inventory_items%ROWTYPE;
  v_dest_item public.inventory_items%ROWTYPE;
  v_seq int := 0;
BEGIN
  SELECT COUNT(*) INTO v_seq
  FROM public.warehouse_transfers
  WHERE transfer_no LIKE 'TR-BF-%';

  FOR v_src IN
    SELECT m.*
    FROM public.inventory_movements m
    WHERE m.movement_type = 'transfer'
      AND m.destination_warehouse_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.warehouse_transfer_items wti
        WHERE wti.source_movement_id = m.id
      )
    ORDER BY m.performed_at ASC
  LOOP
    SELECT * INTO v_src_item
    FROM public.inventory_items
    WHERE id = v_src.item_id;

    IF v_src_item IS NULL THEN
      CONTINUE;
    END IF;

    SELECT m.* INTO v_dest
    FROM public.inventory_movements m
    JOIN public.inventory_items i ON i.id = m.item_id
    WHERE m.movement_type = 'in'
      AND m.warehouse_id = v_src.destination_warehouse_id
      AND m.quantity = v_src.quantity
      AND m.performed_by IS NOT DISTINCT FROM v_src.performed_by
      AND ABS(EXTRACT(EPOCH FROM (m.performed_at - v_src.performed_at))) <= 5
      AND trim(i.name) = trim(v_src_item.name)
      AND NOT EXISTS (
        SELECT 1 FROM public.warehouse_transfer_items wti
        WHERE wti.destination_movement_id = m.id
      )
    ORDER BY ABS(EXTRACT(EPOCH FROM (m.performed_at - v_src.performed_at))) ASC
    LIMIT 1;

    IF v_dest.id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_dest_item
    FROM public.inventory_items
    WHERE id = v_dest.item_id;

    IF v_dest_item IS NULL THEN
      CONTINUE;
    END IF;

    v_seq := v_seq + 1;
    v_transfer_no := 'TR-BF-' || lpad(v_seq::text, 4, '0');

    INSERT INTO public.warehouse_transfers(
      transfer_no,
      source_warehouse_id,
      destination_warehouse_id,
      status,
      created_by,
      sent_by,
      received_by,
      created_at,
      sent_at,
      received_at,
      notes,
      audit_log,
      legacy_dual_post
    ) VALUES (
      v_transfer_no,
      v_src.warehouse_id,
      v_src.destination_warehouse_id,
      'received',
      v_src.performed_by,
      v_src.performed_by,
      v_src.performed_by,
      v_src.performed_at,
      v_src.performed_at,
      v_dest.performed_at,
      'Backfilled from existing movement pair (late reconciliation)',
      jsonb_build_array(jsonb_build_object(
        'event','backfilled',
        'at', now(),
        'kind','late_clean_pair'
      )),
      true
    ) RETURNING id INTO v_transfer_id;

    INSERT INTO public.warehouse_transfer_items(
      transfer_id,
      source_item_id,
      destination_item_id,
      item_name,
      unit,
      requested_qty,
      sent_qty,
      received_qty,
      unit_cost,
      total_cost,
      receive_notes,
      source_movement_id,
      destination_movement_id,
      line_status
    ) VALUES (
      v_transfer_id,
      v_src.item_id,
      v_dest.item_id,
      v_src_item.name,
      v_src_item.unit,
      v_src.quantity,
      v_src.quantity,
      v_src.quantity,
      v_src.unit_cost,
      v_src.quantity * COALESCE(v_src.unit_cost, 0),
      'Historical reconciliation of direct transfer pair',
      v_src.id,
      v_dest.id,
      'received'
    );
  END LOOP;
END $$;