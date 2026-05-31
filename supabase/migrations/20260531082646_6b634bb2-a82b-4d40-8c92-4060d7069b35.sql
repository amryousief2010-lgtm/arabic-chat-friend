
-- Meat factory production module (mirror of feed pattern)

-- 1) Extend meat_factory_products with stock tracking columns
ALTER TABLE public.meat_factory_products
  ADD COLUMN IF NOT EXISTS current_stock numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS latest_unit_cost numeric NOT NULL DEFAULT 0;

-- 2) Production invoices header
CREATE TABLE IF NOT EXISTS public.meat_production_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prod_no text NOT NULL UNIQUE DEFAULT ('MPROD-' || to_char(now(),'YYMMDDHH24MISSMS')),
  prod_date date NOT NULL DEFAULT CURRENT_DATE,
  product_id uuid NOT NULL REFERENCES public.meat_factory_products(id) ON DELETE RESTRICT,
  qty_produced numeric NOT NULL CHECK (qty_produced > 0),
  total_cost numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  transferred_to_main_qty numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Production invoice items (raw consumed)
CREATE TABLE IF NOT EXISTS public.meat_production_invoice_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES public.meat_production_invoices(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.meat_factory_raw_materials(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0,
  line_cost numeric NOT NULL DEFAULT 0
);

-- 4) Transfer log: finished meat product → main warehouse
CREATE TABLE IF NOT EXISTS public.meat_production_transfers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transfer_no text NOT NULL UNIQUE DEFAULT ('MTRX-' || to_char(now(),'YYMMDDHH24MISSMS')),
  invoice_id uuid REFERENCES public.meat_production_invoices(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.meat_factory_products(id) ON DELETE RESTRICT,
  destination_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_production_invoices TO authenticated;
GRANT ALL ON public.meat_production_invoices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_production_invoice_items TO authenticated;
GRANT ALL ON public.meat_production_invoice_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_production_transfers TO authenticated;
GRANT ALL ON public.meat_production_transfers TO service_role;

ALTER TABLE public.meat_production_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meat_production_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meat_production_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meat read prod invoices" ON public.meat_production_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "meat write prod invoices" ON public.meat_production_invoices FOR INSERT TO authenticated WITH CHECK (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'meat_factory_manager') OR has_role(auth.uid(),'production_manager')
  OR has_role(auth.uid(),'warehouse_supervisor')
);
CREATE POLICY "meat update prod invoices" ON public.meat_production_invoices FOR UPDATE TO authenticated USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
);
CREATE POLICY "meat delete prod invoices" ON public.meat_production_invoices FOR DELETE TO authenticated USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
);

CREATE POLICY "meat read prod items" ON public.meat_production_invoice_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "meat write prod items" ON public.meat_production_invoice_items FOR INSERT TO authenticated WITH CHECK (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'meat_factory_manager') OR has_role(auth.uid(),'production_manager')
  OR has_role(auth.uid(),'warehouse_supervisor')
);
CREATE POLICY "meat update prod items" ON public.meat_production_invoice_items FOR UPDATE TO authenticated USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
);
CREATE POLICY "meat delete prod items" ON public.meat_production_invoice_items FOR DELETE TO authenticated USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
);

CREATE POLICY "meat read transfers" ON public.meat_production_transfers FOR SELECT TO authenticated USING (true);
CREATE POLICY "meat write transfers" ON public.meat_production_transfers FOR INSERT TO authenticated WITH CHECK (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'meat_factory_manager') OR has_role(auth.uid(),'production_manager')
  OR has_role(auth.uid(),'warehouse_supervisor')
);
CREATE POLICY "meat delete transfers" ON public.meat_production_transfers FOR DELETE TO authenticated USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
);

-- 5) On item insert: snapshot unit_cost from raw, deduct raw stock, accumulate line_cost
CREATE OR REPLACE FUNCTION public.apply_meat_production_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cost numeric; v_stock numeric;
BEGIN
  SELECT COALESCE(avg_unit_cost,0), COALESCE(stock,0) INTO v_cost, v_stock
    FROM meat_factory_raw_materials WHERE id = NEW.raw_material_id;
  IF v_stock < NEW.quantity THEN
    RAISE EXCEPTION 'الكمية المطلوبة من الخامة أكبر من الرصيد المتاح (% < %)', v_stock, NEW.quantity;
  END IF;
  NEW.unit_cost := v_cost;
  NEW.line_cost := NEW.quantity * v_cost;

  UPDATE meat_factory_raw_materials
     SET stock = GREATEST(0, stock - NEW.quantity), updated_at = now()
   WHERE id = NEW.raw_material_id;

  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_apply_meat_production_item ON public.meat_production_invoice_items;
CREATE TRIGGER trg_apply_meat_production_item
  BEFORE INSERT ON public.meat_production_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_meat_production_item();

-- 6) Revert raw on item delete
CREATE OR REPLACE FUNCTION public.revert_meat_production_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE meat_factory_raw_materials
     SET stock = COALESCE(stock,0) + OLD.quantity, updated_at = now()
   WHERE id = OLD.raw_material_id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_revert_meat_production_item ON public.meat_production_invoice_items;
CREATE TRIGGER trg_revert_meat_production_item
  AFTER DELETE ON public.meat_production_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.revert_meat_production_item();

-- 7) finalize_meat_production: roll up costs, add to finished product stock (weighted avg)
CREATE OR REPLACE FUNCTION public.finalize_meat_production(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total numeric; v_qty numeric; v_prod uuid;
  v_old_stock numeric; v_old_cost numeric; v_new_cost numeric;
BEGIN
  SELECT COALESCE(SUM(line_cost),0) INTO v_total
    FROM meat_production_invoice_items WHERE invoice_id = _invoice_id;

  SELECT qty_produced, product_id INTO v_qty, v_prod
    FROM meat_production_invoices WHERE id = _invoice_id;

  SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost,0)
    INTO v_old_stock, v_old_cost
    FROM meat_factory_products WHERE id = v_prod;

  IF (v_old_stock + v_qty) > 0 THEN
    v_new_cost := ((v_old_stock*v_old_cost) + v_total) / (v_old_stock + v_qty);
  ELSE
    v_new_cost := 0;
  END IF;

  UPDATE meat_factory_products
     SET current_stock = COALESCE(current_stock,0) + v_qty,
         latest_unit_cost = v_new_cost,
         updated_at = now()
   WHERE id = v_prod;

  UPDATE meat_production_invoices
     SET total_cost = v_total,
         unit_cost = CASE WHEN v_qty > 0 THEN v_total / v_qty ELSE 0 END,
         updated_at = now()
   WHERE id = _invoice_id;
END $$;

-- 8) RPC: transfer finished meat product to main warehouse
CREATE OR REPLACE FUNCTION public.meat_production_transfer_to_main(
  _product_id uuid, _qty numeric, _invoice_id uuid DEFAULT NULL, _notes text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock numeric; v_cost numeric;
  v_main_wh uuid; v_transfer_id uuid;
  v_inv_item uuid; v_product_name text;
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

  -- Deduct from finished factory stock
  UPDATE meat_factory_products
     SET current_stock = GREATEST(0, COALESCE(current_stock,0) - _qty),
         updated_at = now()
   WHERE id = _product_id;

  -- Log transfer
  INSERT INTO meat_production_transfers
    (invoice_id, product_id, destination_warehouse_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES (_invoice_id, _product_id, v_main_wh, _qty, v_cost, _qty * v_cost, _notes, auth.uid())
  RETURNING id INTO v_transfer_id;

  -- Find/create matching inventory_item row in main warehouse by product name
  SELECT id INTO v_inv_item FROM inventory_items
    WHERE warehouse_id = v_main_wh AND name = v_product_name AND is_active = true
    LIMIT 1;

  IF v_inv_item IS NULL THEN
    INSERT INTO inventory_items (warehouse_id, name, unit, stock, module)
    VALUES (v_main_wh, v_product_name, 'كجم', _qty, 'meat_factory')
    RETURNING id INTO v_inv_item;
  ELSE
    UPDATE inventory_items
      SET stock = COALESCE(stock,0) + _qty, updated_at = now()
      WHERE id = v_inv_item;
  END IF;

  -- Inventory movement
  INSERT INTO inventory_movements
    (item_id, warehouse_id, destination_warehouse_id, movement_type, quantity, unit_cost, total_cost,
     reference_type, reference_id, reference, party, notes, performed_by)
  VALUES
    (v_inv_item, v_main_wh, v_main_wh, 'production_in', _qty, v_cost, _qty * v_cost,
     'meat_production_transfer', v_transfer_id, 'تحويل منتج تام لحوم للرئيسي',
     'مصنع اللحوم', _notes, auth.uid());

  -- Update invoice running tally
  IF _invoice_id IS NOT NULL THEN
    UPDATE meat_production_invoices
      SET transferred_to_main_qty = COALESCE(transferred_to_main_qty,0) + _qty,
          updated_at = now()
      WHERE id = _invoice_id;
  END IF;

  RETURN v_transfer_id;
END $$;

GRANT EXECUTE ON FUNCTION public.finalize_meat_production(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meat_production_transfer_to_main(uuid, numeric, uuid, text) TO authenticated;
