
-- 1) Add cancellation tracking columns (idempotent)
ALTER TABLE public.meat_manufacturing_invoices
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- 2) Cancellation RPC with automatic inventory reversal
CREATE OR REPLACE FUNCTION public.cancel_meat_manufacturing_invoice(
  p_invoice_id uuid,
  p_reason     text,
  p_force_partial boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.meat_manufacturing_invoices%ROWTYPE;
  v_is_manager boolean;
  v_is_factory_mgr boolean;
  v_move record;
  v_item public.meat_factory_raw_items%ROWTYPE;
  v_fin_stock numeric := 0;
  v_fin_reverse_qty numeric := 0;
  v_partial boolean := false;
  v_reversed_raw int := 0;
  v_carryover_out_reverted int := 0;
  v_carryover_in_reverted int := 0;
  v_before jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  v_is_manager := public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role, 'executive_manager'::app_role
  ]);
  v_is_factory_mgr := public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role, 'executive_manager'::app_role,
    'production_manager'::app_role, 'meat_factory_manager'::app_role
  ]);

  IF NOT v_is_factory_mgr THEN
    RAISE EXCEPTION 'الإلغاء متاح للمدير العام أو التنفيذي أو مدير المصنع/الإنتاج فقط';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'يجب كتابة سبب الإلغاء (٣ أحرف على الأقل)';
  END IF;

  SELECT * INTO v_inv FROM public.meat_manufacturing_invoices
    WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;

  IF v_inv.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'already_cancelled', true,
      'message', 'الفاتورة ملغاة بالفعل');
  END IF;

  IF v_inv.status = 'transferred' THEN
    RAISE EXCEPTION 'لا يمكن إلغاء فاتورة تم تحويل منتجها النهائي إلى مخزن آخر. اعمل تسوية إدارية.';
  END IF;

  v_before := to_jsonb(v_inv);

  -- DRAFT: no inventory effect, just void
  IF v_inv.status = 'draft' THEN
    UPDATE public.meat_manufacturing_invoices
      SET status='cancelled', cancelled_by=v_uid, cancelled_at=now(),
          cancel_reason=p_reason, updated_at=now()
      WHERE id = p_invoice_id;

    INSERT INTO public.meat_factory_audit_log(table_name, row_id, action, old_value, new_value, performed_by)
    VALUES ('meat_manufacturing_invoices', p_invoice_id, 'cancel_draft',
            v_before,
            jsonb_build_object('reason', p_reason, 'inventory_impact', false),
            v_uid);

    RETURN jsonb_build_object('success', true, 'invoice_no', v_inv.invoice_no,
      'message', 'تم إلغاء الفاتورة (لم تكن معتمدة، لا أثر على المخزون)');
  END IF;

  IF v_inv.status <> 'approved' THEN
    RAISE EXCEPTION 'لا يمكن إلغاء فاتورة بحالة %', v_inv.status;
  END IF;

  -- APPROVED: reverse inventory
  -- 2a) Check finished-product availability BEFORE doing any reversals
  IF v_inv.finished_item_id IS NOT NULL AND v_inv.finished_qty > 0 THEN
    SELECT COALESCE(stock,0) INTO v_fin_stock FROM public.inventory_items
      WHERE id = v_inv.finished_item_id FOR UPDATE;

    IF v_fin_stock + 0.0001 < v_inv.finished_qty THEN
      IF NOT (p_force_partial AND v_is_manager) THEN
        RAISE EXCEPTION 'لا يمكن إلغاء الفاتورة لأن المنتج النهائي تم صرفه أو بيعه جزئياً. المتاح: % | المطلوب عكسه: %. يحتاج صلاحية مدير عام/تنفيذي مع إلغاء جزئي.',
          v_fin_stock, v_inv.finished_qty;
      END IF;
      v_partial := true;
      v_fin_reverse_qty := v_fin_stock;
    ELSE
      v_fin_reverse_qty := v_inv.finished_qty;
    END IF;
  END IF;

  -- 2b) Reverse raw/spice/packaging OUT moves with IN reversal moves
  FOR v_move IN
    SELECT * FROM public.meat_factory_inventory_moves
     WHERE ref_table = 'meat_manufacturing_invoices'
       AND ref_id    = p_invoice_id
       AND direction = 'OUT'
       AND COALESCE(reason,'') NOT LIKE '%REVERSAL%'
  LOOP
    -- skip if a reversal already exists for this original move
    IF EXISTS (
      SELECT 1 FROM public.meat_factory_inventory_moves
       WHERE ref_table = 'meat_manufacturing_invoices'
         AND ref_id    = p_invoice_id
         AND item_id   = v_move.item_id
         AND direction = 'IN'
         AND reason LIKE 'REVERSAL%'
    ) THEN CONTINUE; END IF;

    SELECT * INTO v_item FROM public.meat_factory_raw_items
      WHERE id = v_move.item_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    UPDATE public.meat_factory_raw_items
      SET current_stock = current_stock + v_move.quantity,
          updated_at = now()
      WHERE id = v_move.item_id;

    INSERT INTO public.meat_factory_inventory_moves(
      item_kind, item_id, item_name, direction, quantity, unit_cost,
      reason, ref_table, ref_id, created_by, stock_before, stock_after
    ) VALUES (
      v_move.item_kind, v_move.item_id, v_move.item_name, 'IN',
      v_move.quantity, v_move.unit_cost,
      'REVERSAL إلغاء فاتورة تصنيع ' || v_inv.invoice_no || ' — ' || p_reason,
      'meat_manufacturing_invoices', p_invoice_id, v_uid,
      v_item.current_stock,
      v_item.current_stock + v_move.quantity
    );

    v_reversed_raw := v_reversed_raw + 1;
  END LOOP;

  -- 2c) Reverse finished-product IN with OUT
  IF v_inv.finished_item_id IS NOT NULL AND v_fin_reverse_qty > 0 THEN
    UPDATE public.inventory_items
      SET stock = GREATEST(0, stock - v_fin_reverse_qty),
          updated_at = now()
      WHERE id = v_inv.finished_item_id;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity, unit_cost,
      performed_by, notes, reference, party
    ) VALUES (
      v_inv.finished_item_id, v_inv.factory_warehouse_id, 'out',
      v_fin_reverse_qty, COALESCE(v_inv.unit_cost,0), v_uid,
      'REVERSAL إلغاء فاتورة تصنيع ' || v_inv.invoice_no || ' — ' || p_reason
        || CASE WHEN v_partial THEN ' (إلغاء جزئي بصلاحية المدير)' ELSE '' END,
      v_inv.invoice_no || '-REV', 'مصنع اللحوم'
    );
  END IF;

  -- 2d) Revert carryover_out balances created by this invoice
  WITH upd AS (
    UPDATE public.meat_factory_carryover_dough
      SET status = 'cancelled',
          damaged_by = v_uid,
          damaged_at = now(),
          damaged_reason = 'إلغاء فاتورة التصنيع الأصلية — ' || p_reason,
          updated_at = now()
      WHERE source_invoice_id = p_invoice_id
        AND status <> 'cancelled'
      RETURNING 1
  ) SELECT count(*) INTO v_carryover_out_reverted FROM upd;

  -- 2e) Revert carryover_in usages (restore remaining qty + delete usage rows)
  FOR v_move IN
    SELECT * FROM public.meat_factory_carryover_dough_usage
     WHERE used_in_invoice_id = p_invoice_id
  LOOP
    UPDATE public.meat_factory_carryover_dough
      SET remaining_qty_kg = LEAST(original_qty_kg, COALESCE(remaining_qty_kg,0) + v_move.used_qty_kg),
          status = CASE
            WHEN LEAST(original_qty_kg, COALESCE(remaining_qty_kg,0) + v_move.used_qty_kg)
                 >= original_qty_kg - 0.0001 THEN 'available'
            ELSE 'partial'
          END,
          updated_at = now()
      WHERE id = v_move.carryover_id;

    DELETE FROM public.meat_factory_carryover_dough_usage WHERE id = v_move.id;
    v_carryover_in_reverted := v_carryover_in_reverted + 1;
  END LOOP;

  -- 3) Flip invoice status
  UPDATE public.meat_manufacturing_invoices
    SET status='cancelled',
        cancelled_by=v_uid, cancelled_at=now(),
        cancel_reason=p_reason, updated_at=now()
    WHERE id = p_invoice_id;

  -- 4) Audit
  INSERT INTO public.meat_factory_audit_log(table_name, row_id, action, old_value, new_value, performed_by)
  VALUES ('meat_manufacturing_invoices', p_invoice_id,
          CASE WHEN v_partial THEN 'cancel_partial' ELSE 'cancel' END,
          v_before,
          jsonb_build_object(
            'reason', p_reason,
            'invoice_no', v_inv.invoice_no,
            'product', v_inv.product_name,
            'finished_qty_original', v_inv.finished_qty,
            'finished_qty_reversed', v_fin_reverse_qty,
            'partial', v_partial,
            'raw_moves_reversed', v_reversed_raw,
            'carryover_out_cancelled', v_carryover_out_reverted,
            'carryover_in_reverted', v_carryover_in_reverted,
            'forced_by_manager', p_force_partial AND v_is_manager
          ),
          v_uid);

  RETURN jsonb_build_object(
    'success', true,
    'invoice_no', v_inv.invoice_no,
    'partial', v_partial,
    'raw_moves_reversed', v_reversed_raw,
    'finished_qty_reversed', v_fin_reverse_qty,
    'carryover_out_cancelled', v_carryover_out_reverted,
    'carryover_in_reverted', v_carryover_in_reverted,
    'message', CASE
      WHEN v_partial THEN 'تم إلغاء الفاتورة بشكل جزئي مع عكس الكمية المتاحة من المنتج النهائي'
      ELSE 'تم إلغاء الفاتورة وعكس كامل أثرها على المخزون'
    END
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.cancel_meat_manufacturing_invoice(uuid, text, boolean) TO authenticated;
