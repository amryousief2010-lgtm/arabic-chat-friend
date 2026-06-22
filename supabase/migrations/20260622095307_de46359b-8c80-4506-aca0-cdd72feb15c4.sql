CREATE OR REPLACE FUNCTION public.approve_meat_manufacturing_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.meat_manufacturing_invoices%ROWTYPE;
  v_agg record;
  v_item public.meat_factory_raw_items%ROWTYPE;
  v_finished_item_id uuid;
  v_raw_cost numeric := 0;
  v_spice_cost numeric := 0;
  v_pack_cost numeric := 0;
  v_total numeric := 0;
  v_lines int := 0;
  v_msg text;
  v_existing_move_id uuid;
  v_moves_created int := 0;
  v_moves_skipped int := 0;
  v_finished_existed boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role, 'executive_manager'::app_role,
    'production_manager'::app_role, 'meat_factory_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'الاعتماد متاح للمدير العام أو التنفيذي أو مدير المصنع/الإنتاج فقط';
  END IF;

  SELECT * INTO v_inv FROM public.meat_manufacturing_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;

  -- Idempotent short-circuit: already approved → return success no-op
  IF v_inv.status IN ('approved','transferred') THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_approved', true,
      'message', 'الفاتورة معتمدة بالفعل — لم يتم إعادة التنفيذ',
      'invoice_no', v_inv.invoice_no
    );
  END IF;
  IF v_inv.status IN ('rejected','cancelled') THEN
    RAISE EXCEPTION 'لا يمكن اعتماد فاتورة بحالة %', v_inv.status;
  END IF;

  -- Aggregate lines per (item_id, kind) — collapses duplicate rows for the same item
  -- Validate stock against the *aggregated* required quantity
  FOR v_agg IN
    SELECT
      l.item_id,
      COALESCE(MAX(l.kind), 'raw') AS kind,
      MAX(l.item_name) AS item_name,
      SUM(l.quantity) AS quantity,
      CASE WHEN SUM(l.quantity) > 0
           THEN SUM(l.quantity * l.unit_cost) / SUM(l.quantity)
           ELSE 0 END AS unit_cost,
      SUM(l.line_total) AS line_total
    FROM public.meat_manufacturing_invoice_lines l
    WHERE l.invoice_id = p_invoice_id
    GROUP BY l.item_id
  LOOP
    SELECT * INTO v_item FROM public.meat_factory_raw_items WHERE id = v_agg.item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود في مخزن خامات مصنع اللحوم: %', v_agg.item_name; END IF;

    -- If a move already exists for this (invoice,item,OUT), treat as already-done; do not re-check stock
    SELECT id INTO v_existing_move_id
      FROM public.meat_factory_inventory_moves
     WHERE ref_table = 'meat_manufacturing_invoices'
       AND ref_id = p_invoice_id
       AND item_id = v_agg.item_id
       AND direction = 'OUT'
     LIMIT 1;

    IF v_existing_move_id IS NULL THEN
      IF v_item.current_stock < v_agg.quantity THEN
        v_msg := format('الرصيد المتاح من الصنف %s غير كافٍ (المتاح %s، المطلوب %s)',
          v_item.name, v_item.current_stock, v_agg.quantity);
        RAISE EXCEPTION '%', v_msg;
      END IF;

      UPDATE public.meat_factory_raw_items
        SET current_stock = v_item.current_stock - v_agg.quantity, updated_at = now()
        WHERE id = v_item.id;

      INSERT INTO public.meat_factory_inventory_moves(
        item_kind, item_id, item_name, direction, quantity, unit_cost, reason,
        ref_table, ref_id, created_by, stock_before, stock_after
      ) VALUES (
        v_agg.kind, v_item.id, v_item.name, 'OUT',
        v_agg.quantity, v_agg.unit_cost,
        'صرف للتصنيع — ' || v_inv.product_name,
        'meat_manufacturing_invoices', p_invoice_id, v_uid,
        v_item.current_stock, v_item.current_stock - v_agg.quantity
      )
      ON CONFLICT (ref_id, item_id, direction)
        WHERE ref_table = 'meat_manufacturing_invoices'
        DO NOTHING;

      v_moves_created := v_moves_created + 1;
    ELSE
      v_moves_skipped := v_moves_skipped + 1;
    END IF;

    -- Snapshot the latest stock_before/after on ONE representative line (any duplicates remain)
    UPDATE public.meat_manufacturing_invoice_lines
      SET stock_before = v_item.current_stock,
          stock_after  = v_item.current_stock - v_agg.quantity
      WHERE invoice_id = p_invoice_id AND item_id = v_agg.item_id;

    IF v_agg.kind = 'spice' THEN v_spice_cost := v_spice_cost + v_agg.line_total;
    ELSIF v_agg.kind = 'packaging' THEN v_pack_cost := v_pack_cost + v_agg.line_total;
    ELSE v_raw_cost := v_raw_cost + v_agg.line_total;
    END IF;
    v_total := v_total + v_agg.line_total;
    v_lines := v_lines + 1;
  END LOOP;

  IF v_lines = 0 THEN RAISE EXCEPTION 'لا توجد أصناف في الفاتورة'; END IF;

  v_total := v_total + COALESCE(v_inv.extra_cost, 0);

  -- Finished product item (reuse / create)
  v_finished_item_id := v_inv.finished_item_id;
  IF v_finished_item_id IS NULL THEN
    SELECT id INTO v_finished_item_id
      FROM public.inventory_items
     WHERE name = v_inv.product_name AND warehouse_id = v_inv.factory_warehouse_id
     LIMIT 1;
    IF v_finished_item_id IS NULL THEN
      INSERT INTO public.inventory_items(name, warehouse_id, category, unit, stock, unit_cost)
      VALUES (v_inv.product_name, v_inv.factory_warehouse_id, 'meat_finished', 'كجم', 0, 0)
      RETURNING id INTO v_finished_item_id;
    END IF;
  END IF;

  -- Guard: only insert finished-product inventory_movements row once per invoice
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_movements
     WHERE reference = v_inv.invoice_no
       AND item_id = v_finished_item_id
       AND movement_type = 'in'
  ) THEN
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity, unit_cost, performed_by, notes, reference, party
    ) VALUES (
      v_finished_item_id, v_inv.factory_warehouse_id, 'in', v_inv.finished_qty,
      ROUND(v_total / NULLIF(v_inv.finished_qty,0), 3), v_uid,
      'إنتاج تام من فاتورة تصنيع ' || v_inv.invoice_no,
      v_inv.invoice_no, 'مصنع اللحوم'
    );
  ELSE
    v_finished_existed := true;
  END IF;

  UPDATE public.meat_manufacturing_invoices
    SET status = 'approved',
        approved_by = v_uid, approved_at = now(),
        finished_item_id = v_finished_item_id,
        raw_cost = v_raw_cost, spice_cost = v_spice_cost, packaging_cost = v_pack_cost,
        materials_total_cost = v_raw_cost + v_spice_cost + v_pack_cost,
        total_manufacturing_cost = v_total,
        unit_cost = ROUND(v_total / NULLIF(v_inv.finished_qty,0), 3),
        updated_at = now()
    WHERE id = p_invoice_id;

  INSERT INTO public.meat_factory_audit_log(table_name, row_id, action, new_value, performed_by)
  VALUES ('meat_manufacturing_invoices', p_invoice_id, 'approve',
          jsonb_build_object(
            'product', v_inv.product_name, 'qty', v_inv.finished_qty,
            'raw_cost', v_raw_cost, 'spice_cost', v_spice_cost,
            'packaging_cost', v_pack_cost, 'total', v_total,
            'moves_created', v_moves_created, 'moves_skipped', v_moves_skipped,
            'finished_movement_existed', v_finished_existed
          ),
          v_uid);

  RETURN jsonb_build_object(
    'success', true,
    'invoice_no', v_inv.invoice_no,
    'finished_item_id', v_finished_item_id,
    'raw_cost', v_raw_cost, 'spice_cost', v_spice_cost,
    'packaging_cost', v_pack_cost, 'total_cost', v_total,
    'unit_cost', ROUND(v_total / NULLIF(v_inv.finished_qty,0), 3),
    'moves_created', v_moves_created,
    'moves_skipped', v_moves_skipped,
    'finished_movement_existed', v_finished_existed,
    'message', CASE WHEN v_moves_skipped > 0 OR v_finished_existed
                    THEN 'تم العثور على حركات مخزون سابقة لهذه الفاتورة. تم منع التكرار واستكمال الاعتماد بأمان.'
                    ELSE 'تم اعتماد الفاتورة بنجاح' END
  );
END $function$;