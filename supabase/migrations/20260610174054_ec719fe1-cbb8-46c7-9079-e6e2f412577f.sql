
-- Phase 2: Manufacturing invoice upgrades

ALTER TABLE public.meat_manufacturing_invoices
  ADD COLUMN IF NOT EXISTS manufacturing_invoice_uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS destination_kind text NOT NULL DEFAULT 'factory_warehouse',
  ADD COLUMN IF NOT EXISTS raw_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spice_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packaging_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_manufacturing_cost numeric NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meat_mfg_invoices_uuid ON public.meat_manufacturing_invoices(manufacturing_invoice_uuid);

ALTER TABLE public.meat_manufacturing_invoices
  DROP CONSTRAINT IF EXISTS meat_mfg_destination_kind_check;
ALTER TABLE public.meat_manufacturing_invoices
  ADD CONSTRAINT meat_mfg_destination_kind_check CHECK (destination_kind IN ('factory_warehouse','main_warehouse_direct'));

ALTER TABLE public.meat_manufacturing_invoice_lines
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'raw',
  ADD COLUMN IF NOT EXISTS stock_before numeric,
  ADD COLUMN IF NOT EXISTS stock_after numeric,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.meat_manufacturing_invoice_lines
  DROP CONSTRAINT IF EXISTS meat_mfg_line_kind_check;
ALTER TABLE public.meat_manufacturing_invoice_lines
  ADD CONSTRAINT meat_mfg_line_kind_check CHECK (kind IN ('raw','spice','packaging'));

-- Anti-duplicate: only one OUT move per (mfg_invoice, item)
CREATE UNIQUE INDEX IF NOT EXISTS uq_meat_moves_mfg_invoice_item
  ON public.meat_factory_inventory_moves(ref_id, item_id, direction)
  WHERE ref_table = 'meat_manufacturing_invoices';

-- Replace approve function to deduct from meat_factory_raw_items
CREATE OR REPLACE FUNCTION public.approve_meat_manufacturing_invoice(p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.meat_manufacturing_invoices%ROWTYPE;
  v_line record;
  v_item public.meat_factory_raw_items%ROWTYPE;
  v_finished_item_id uuid;
  v_raw_cost numeric := 0;
  v_spice_cost numeric := 0;
  v_pack_cost numeric := 0;
  v_total numeric := 0;
  v_lines int := 0;
  v_msg text;
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
  IF v_inv.status = 'approved' OR v_inv.status = 'transferred' THEN
    RAISE EXCEPTION 'تم اعتماد فاتورة التصنيع من قبل ولا يمكن اعتمادها مرة أخرى';
  END IF;
  IF v_inv.status IN ('rejected','cancelled') THEN
    RAISE EXCEPTION 'لا يمكن اعتماد فاتورة بحالة %', v_inv.status;
  END IF;

  -- 1) Validate stock for every line (no partial deductions)
  FOR v_line IN SELECT * FROM public.meat_manufacturing_invoice_lines WHERE invoice_id = p_invoice_id LOOP
    SELECT * INTO v_item FROM public.meat_factory_raw_items WHERE id = v_line.item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود في مخزن خامات مصنع اللحوم: %', v_line.item_name; END IF;
    IF v_item.current_stock < v_line.quantity THEN
      v_msg := format('الرصيد المتاح من الصنف %s غير كافٍ لإتمام فاتورة التصنيع (المتاح %s، المطلوب %s)',
        v_item.name, v_item.current_stock, v_line.quantity);
      RAISE EXCEPTION '%', v_msg;
    END IF;
    v_lines := v_lines + 1;
  END LOOP;

  IF v_lines = 0 THEN RAISE EXCEPTION 'لا توجد أصناف في الفاتورة'; END IF;

  -- 2) Deduct + record moves
  FOR v_line IN SELECT * FROM public.meat_manufacturing_invoice_lines WHERE invoice_id = p_invoice_id LOOP
    SELECT * INTO v_item FROM public.meat_factory_raw_items WHERE id = v_line.item_id FOR UPDATE;
    UPDATE public.meat_factory_raw_items
      SET current_stock = v_item.current_stock - v_line.quantity, updated_at = now()
      WHERE id = v_item.id;

    INSERT INTO public.meat_factory_inventory_moves(
      item_kind, item_id, item_name, direction, quantity, unit_cost, reason,
      ref_table, ref_id, created_by, stock_before, stock_after
    ) VALUES (
      COALESCE(v_line.kind, 'raw'), v_item.id, v_item.name, 'OUT',
      v_line.quantity, v_line.unit_cost,
      'صرف للتصنيع — ' || v_inv.product_name,
      'meat_manufacturing_invoices', p_invoice_id, v_uid,
      v_item.current_stock, v_item.current_stock - v_line.quantity
    );

    -- Update line snapshot
    UPDATE public.meat_manufacturing_invoice_lines
      SET stock_before = v_item.current_stock,
          stock_after = v_item.current_stock - v_line.quantity
      WHERE id = v_line.id;

    IF v_line.kind = 'spice' THEN v_spice_cost := v_spice_cost + v_line.line_total;
    ELSIF v_line.kind = 'packaging' THEN v_pack_cost := v_pack_cost + v_line.line_total;
    ELSE v_raw_cost := v_raw_cost + v_line.line_total;
    END IF;
    v_total := v_total + v_line.line_total;
  END LOOP;

  v_total := v_total + COALESCE(v_inv.extra_cost, 0);

  -- 3) Add finished product to inventory_items in factory warehouse (kept for transfer flow)
  SELECT id INTO v_finished_item_id FROM public.inventory_items
    WHERE warehouse_id = v_inv.factory_warehouse_id
      AND trim(name) = trim(v_inv.product_name)
      AND category = 'منتج تام مصنع اللحوم'
    LIMIT 1;

  IF v_finished_item_id IS NULL THEN
    INSERT INTO public.inventory_items(warehouse_id, name, category, unit, stock, unit_cost, low_stock_threshold)
    VALUES (v_inv.factory_warehouse_id, v_inv.product_name, 'منتج تام مصنع اللحوم',
            v_inv.unit, 0, ROUND(v_total / NULLIF(v_inv.finished_qty,0), 3), 0)
    RETURNING id INTO v_finished_item_id;
  END IF;

  INSERT INTO public.inventory_movements(
    item_id, warehouse_id, movement_type, quantity, unit_cost, performed_by, notes, reference, party
  ) VALUES (
    v_finished_item_id, v_inv.factory_warehouse_id, 'in', v_inv.finished_qty,
    ROUND(v_total / NULLIF(v_inv.finished_qty,0), 3), v_uid,
    'إنتاج تام من فاتورة تصنيع ' || v_inv.invoice_no,
    v_inv.invoice_no, 'مصنع اللحوم'
  );

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
          jsonb_build_object('product', v_inv.product_name, 'qty', v_inv.finished_qty,
                             'raw_cost', v_raw_cost, 'spice_cost', v_spice_cost,
                             'packaging_cost', v_pack_cost, 'total', v_total),
          v_uid);

  RETURN jsonb_build_object(
    'success', true, 'invoice_no', v_inv.invoice_no,
    'finished_item_id', v_finished_item_id,
    'raw_cost', v_raw_cost, 'spice_cost', v_spice_cost,
    'packaging_cost', v_pack_cost, 'total_cost', v_total,
    'unit_cost', ROUND(v_total / NULLIF(v_inv.finished_qty,0), 3)
  );
END $$;
