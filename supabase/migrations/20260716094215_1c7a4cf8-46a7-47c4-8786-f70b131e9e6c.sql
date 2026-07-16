
-- 1) Add approval state columns to meat_production_transfers
ALTER TABLE public.meat_production_transfers
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid;

-- Backfill existing rows (previous behaviour was auto-received)
UPDATE public.meat_production_transfers
  SET status = 'received',
      received_at = COALESCE(received_at, created_at)
  WHERE status IS NULL OR status = 'received';

-- Constrain values
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meat_production_transfers_status_chk'
  ) THEN
    ALTER TABLE public.meat_production_transfers
      ADD CONSTRAINT meat_production_transfers_status_chk
      CHECK (status IN ('pending','received','rejected'));
  END IF;
END $$;

-- Flip default for NEW rows: pending until warehouse supervisor approves
ALTER TABLE public.meat_production_transfers ALTER COLUMN status SET DEFAULT 'pending';

-- 2) Rewrite meat_production_transfer_to_main so it stages a PENDING transfer:
--    still deducts factory finished stock so it can't be double-sold, but no
--    inventory_items / inventory_movements changes happen until approval.
CREATE OR REPLACE FUNCTION public.meat_production_transfer_to_main(
  _product_id uuid,
  _qty numeric,
  _invoice_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_stock numeric; v_cost numeric;
  v_main_wh uuid; v_transfer_id uuid;
  v_product_name text;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر';
  END IF;

  SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost,0), name_ar
    INTO v_stock, v_cost, v_product_name
    FROM meat_factory_products WHERE id = _product_id;

  IF v_stock < _qty THEN
    RAISE EXCEPTION 'الرصيد المتاح من المنتج التام (%) أقل من الكمية المطلوب تحويلها (%)', v_stock, _qty;
  END IF;

  SELECT id INTO v_main_wh FROM warehouses
    WHERE is_active = true AND (name LIKE '%الرئيسي%' OR name LIKE '%المقر%')
    ORDER BY name LIMIT 1;

  IF v_main_wh IS NULL THEN
    RAISE EXCEPTION 'لم يتم العثور على المخزن الرئيسي';
  END IF;

  -- Deduct from finished factory stock (reserved until approval / released on rejection)
  UPDATE meat_factory_products
     SET current_stock = GREATEST(0, COALESCE(current_stock,0) - _qty),
         updated_at = now()
   WHERE id = _product_id;

  -- Log transfer as PENDING — no inventory movement created yet
  INSERT INTO meat_production_transfers
    (invoice_id, product_id, destination_warehouse_id, quantity, unit_cost, total_cost, notes, created_by, status)
  VALUES (_invoice_id, _product_id, v_main_wh, _qty, v_cost, _qty * v_cost, _notes, auth.uid(), 'pending')
  RETURNING id INTO v_transfer_id;

  -- Update invoice running tally
  IF _invoice_id IS NOT NULL THEN
    UPDATE meat_production_invoices
      SET transferred_to_main_qty = COALESCE(transferred_to_main_qty,0) + _qty,
          updated_at = now()
      WHERE id = _invoice_id;
  END IF;

  RETURN v_transfer_id;
END $$;

-- 3) Approval RPC — warehouse supervisor / GM / EM confirms receipt.
CREATE OR REPLACE FUNCTION public.receive_meat_production_transfer(
  _transfer_id uuid,
  _received_qty numeric DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  t record;
  v_inv_item uuid;
  v_product_name text;
  v_final_qty numeric;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager')
    OR public.has_role(v_uid, 'executive_manager')
    OR public.has_role(v_uid, 'warehouse_supervisor')
    OR public.has_role(v_uid, 'warehouse_manager')
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية اعتماد الوارد';
  END IF;

  SELECT * INTO t FROM meat_production_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF t.status <> 'pending' THEN
    RAISE EXCEPTION 'التحويل ليس بانتظار الاعتماد (الحالة: %)', t.status;
  END IF;

  v_final_qty := COALESCE(_received_qty, t.quantity);
  IF v_final_qty <= 0 THEN RAISE EXCEPTION 'الكمية المستلمة يجب أن تكون أكبر من صفر'; END IF;
  IF v_final_qty > t.quantity THEN
    RAISE EXCEPTION 'الكمية المستلمة (%) أكبر من الكمية المحوّلة (%)', v_final_qty, t.quantity;
  END IF;

  -- If received less than sent, return the difference to factory stock
  IF v_final_qty < t.quantity THEN
    UPDATE meat_factory_products
       SET current_stock = COALESCE(current_stock,0) + (t.quantity - v_final_qty),
           updated_at = now()
     WHERE id = t.product_id;
  END IF;

  SELECT name_ar INTO v_product_name FROM meat_factory_products WHERE id = t.product_id;

  SELECT id INTO v_inv_item FROM inventory_items
    WHERE warehouse_id = t.destination_warehouse_id AND name = v_product_name AND is_active = true
    LIMIT 1;

  IF v_inv_item IS NULL THEN
    INSERT INTO inventory_items (warehouse_id, name, unit, stock, module)
    VALUES (t.destination_warehouse_id, v_product_name, 'كجم', v_final_qty, 'meat_factory')
    RETURNING id INTO v_inv_item;
  ELSE
    UPDATE inventory_items
      SET stock = COALESCE(stock,0) + v_final_qty, updated_at = now()
      WHERE id = v_inv_item;
  END IF;

  INSERT INTO inventory_movements
    (item_id, warehouse_id, destination_warehouse_id, movement_type, quantity, unit_cost, total_cost,
     reference_type, reference_id, reference, party, notes, performed_by)
  VALUES
    (v_inv_item, t.destination_warehouse_id, t.destination_warehouse_id, 'production_in',
     v_final_qty, t.unit_cost, v_final_qty * t.unit_cost,
     'meat_production_transfer', t.id, 'وارد معتمد من مصنع اللحوم',
     'مصنع اللحوم', COALESCE(_notes, t.notes), v_uid);

  UPDATE meat_production_transfers
    SET status = 'received',
        received_at = now(),
        received_by = v_uid,
        quantity = v_final_qty,
        total_cost = v_final_qty * unit_cost,
        notes = COALESCE(_notes, notes)
    WHERE id = t.id;

  RETURN t.id;
END $$;

-- 4) Rejection RPC — returns qty to factory stock without touching main warehouse.
CREATE OR REPLACE FUNCTION public.reject_meat_production_transfer(
  _transfer_id uuid,
  _reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  t record;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager')
    OR public.has_role(v_uid, 'executive_manager')
    OR public.has_role(v_uid, 'warehouse_supervisor')
    OR public.has_role(v_uid, 'warehouse_manager')
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية رفض الوارد';
  END IF;

  SELECT * INTO t FROM meat_production_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF t.status <> 'pending' THEN
    RAISE EXCEPTION 'التحويل ليس بانتظار الاعتماد';
  END IF;

  -- Return reserved qty to factory finished stock
  UPDATE meat_factory_products
     SET current_stock = COALESCE(current_stock,0) + t.quantity,
         updated_at = now()
   WHERE id = t.product_id;

  -- Reverse invoice tally if any
  IF t.invoice_id IS NOT NULL THEN
    UPDATE meat_production_invoices
      SET transferred_to_main_qty = GREATEST(0, COALESCE(transferred_to_main_qty,0) - t.quantity),
          updated_at = now()
      WHERE id = t.invoice_id;
  END IF;

  UPDATE meat_production_transfers
    SET status = 'rejected',
        rejected_at = now(),
        rejected_by = v_uid,
        rejection_reason = _reason
    WHERE id = t.id;

  RETURN t.id;
END $$;

GRANT EXECUTE ON FUNCTION public.receive_meat_production_transfer(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_meat_production_transfer(uuid, text) TO authenticated;
