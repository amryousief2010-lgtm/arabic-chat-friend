
-- 1) destination على feed_sales
ALTER TABLE public.feed_sales
  ADD COLUMN IF NOT EXISTS destination_type text NOT NULL DEFAULT 'external_customer',
  ADD COLUMN IF NOT EXISTS destination_ref_id uuid;

ALTER TABLE public.feed_sales DROP CONSTRAINT IF EXISTS feed_sales_destination_type_check;
ALTER TABLE public.feed_sales ADD CONSTRAINT feed_sales_destination_type_check
  CHECK (destination_type IN ('external_customer','brooding_feed_store','slaughterhouse_feed_store'));

-- 2) أعمدة المصدر على brooding_feed_stock_movements
ALTER TABLE public.brooding_feed_stock_movements
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS invoice_no text;

ALTER TABLE public.brooding_feed_stock_movements
  DROP CONSTRAINT IF EXISTS brooding_feed_stock_movements_movement_type_check;
ALTER TABLE public.brooding_feed_stock_movements
  ADD CONSTRAINT brooding_feed_stock_movements_movement_type_check
  CHECK (movement_type IN ('opening','purchase','consumption','adjustment','factory_supply','reversal'));

DROP INDEX IF EXISTS uniq_br_feed_invoice_in;
CREATE UNIQUE INDEX uniq_br_feed_invoice_in
  ON public.brooding_feed_stock_movements(source_type, source_id)
  WHERE source_type = 'feed_factory_invoice' AND source_id IS NOT NULL;

-- 3) جدول مخزون علف المجزر
CREATE TABLE IF NOT EXISTS public.slaughterhouse_feed_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_product_id uuid NOT NULL REFERENCES public.feed_products(id),
  feed_name text NOT NULL,
  current_kg numeric NOT NULL DEFAULT 0,
  last_unit_cost numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slaughterhouse_feed_inventory_product_unique UNIQUE (feed_product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slaughterhouse_feed_inventory TO authenticated;
GRANT ALL ON public.slaughterhouse_feed_inventory TO service_role;
ALTER TABLE public.slaughterhouse_feed_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sl_feed_inv_read" ON public.slaughterhouse_feed_inventory;
CREATE POLICY "sl_feed_inv_read" ON public.slaughterhouse_feed_inventory
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sl_feed_inv_manage" ON public.slaughterhouse_feed_inventory;
CREATE POLICY "sl_feed_inv_manage" ON public.slaughterhouse_feed_inventory
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
         OR has_role(auth.uid(),'slaughterhouse_manager') OR has_role(auth.uid(),'warehouse_supervisor')
         OR has_role(auth.uid(),'feed_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
              OR has_role(auth.uid(),'slaughterhouse_manager') OR has_role(auth.uid(),'warehouse_supervisor')
              OR has_role(auth.uid(),'feed_factory_manager'));

-- 4) جدول حركات علف المجزر
CREATE TABLE IF NOT EXISTS public.slaughterhouse_feed_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id uuid NOT NULL REFERENCES public.slaughterhouse_feed_inventory(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('opening','factory_supply','consumption','adjustment','reversal')),
  quantity_kg numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  source_type text NOT NULL DEFAULT 'manual',
  source_id uuid,
  invoice_no text,
  reference_no text,
  notes text,
  performed_by uuid REFERENCES auth.users(id),
  performed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS uniq_sl_feed_invoice_in;
CREATE UNIQUE INDEX uniq_sl_feed_invoice_in
  ON public.slaughterhouse_feed_movements(source_type, source_id)
  WHERE source_type = 'feed_factory_invoice' AND source_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.slaughterhouse_feed_movements TO authenticated;
GRANT ALL ON public.slaughterhouse_feed_movements TO service_role;
ALTER TABLE public.slaughterhouse_feed_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sl_feed_mov_read" ON public.slaughterhouse_feed_movements;
CREATE POLICY "sl_feed_mov_read" ON public.slaughterhouse_feed_movements
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sl_feed_mov_insert" ON public.slaughterhouse_feed_movements;
CREATE POLICY "sl_feed_mov_insert" ON public.slaughterhouse_feed_movements
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
              OR has_role(auth.uid(),'slaughterhouse_manager') OR has_role(auth.uid(),'warehouse_supervisor')
              OR is_feed_team(auth.uid()));

DROP POLICY IF EXISTS "sl_feed_mov_admin" ON public.slaughterhouse_feed_movements;
CREATE POLICY "sl_feed_mov_admin" ON public.slaughterhouse_feed_movements
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager'));

-- 5) سجل التدقيق
CREATE TABLE IF NOT EXISTS public.slaughterhouse_feed_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  movement_id uuid,
  feed_id uuid,
  performed_by uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.slaughterhouse_feed_audit_log TO authenticated;
GRANT ALL ON public.slaughterhouse_feed_audit_log TO service_role;
ALTER TABLE public.slaughterhouse_feed_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sl_feed_audit_read" ON public.slaughterhouse_feed_audit_log;
CREATE POLICY "sl_feed_audit_read" ON public.slaughterhouse_feed_audit_log
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sl_feed_audit_insert" ON public.slaughterhouse_feed_audit_log;
CREATE POLICY "sl_feed_audit_insert" ON public.slaughterhouse_feed_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- 6) دالة تحديث الرصيد
CREATE OR REPLACE FUNCTION public.slaughterhouse_feed_apply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE delta numeric;
BEGIN
  IF NEW.movement_type IN ('factory_supply','opening') THEN delta := NEW.quantity_kg;
  ELSIF NEW.movement_type = 'consumption' THEN delta := -NEW.quantity_kg;
  ELSE delta := NEW.quantity_kg; END IF;

  UPDATE public.slaughterhouse_feed_inventory
     SET current_kg = current_kg + delta,
         last_unit_cost = CASE WHEN NEW.unit_cost > 0 THEN NEW.unit_cost ELSE last_unit_cost END,
         updated_at = now()
   WHERE id = NEW.feed_id;

  INSERT INTO public.slaughterhouse_feed_audit_log(action, movement_id, feed_id, performed_by, details)
  VALUES (NEW.movement_type, NEW.id, NEW.feed_id, NEW.performed_by,
          jsonb_build_object('qty', NEW.quantity_kg, 'source_type', NEW.source_type,
                             'source_id', NEW.source_id, 'invoice_no', NEW.invoice_no));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS slaughterhouse_feed_apply_trg ON public.slaughterhouse_feed_movements;
CREATE TRIGGER slaughterhouse_feed_apply_trg
  AFTER INSERT ON public.slaughterhouse_feed_movements
  FOR EACH ROW EXECUTE FUNCTION public.slaughterhouse_feed_apply();

-- 7) دوال مساعدة لضمان وجود صف الصنف
CREATE OR REPLACE FUNCTION public.ensure_brooding_feed_row(_feed_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM brooding_feed_inventory WHERE feed_name = _feed_name;
  IF _id IS NULL THEN
    INSERT INTO brooding_feed_inventory(feed_name, current_kg, last_unit_cost) VALUES (_feed_name, 0, 0)
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.ensure_slaughter_feed_row(_feed_product_id uuid, _feed_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM slaughterhouse_feed_inventory WHERE feed_product_id = _feed_product_id;
  IF _id IS NULL THEN
    INSERT INTO slaughterhouse_feed_inventory(feed_product_id, feed_name, current_kg, last_unit_cost)
    VALUES (_feed_product_id, _feed_name, 0, 0)
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END; $$;

-- 8) Trigger توزيع توريد المصنع للمخزن الداخلي
CREATE OR REPLACE FUNCTION public.feed_sale_item_route_internal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dest text; v_sale_no text; prod_name text; br_id uuid; sl_id uuid;
BEGIN
  IF NEW.feed_product_id IS NULL THEN RETURN NEW; END IF;
  SELECT destination_type, sale_no INTO dest, v_sale_no FROM feed_sales WHERE id = NEW.sale_id;
  IF dest IS NULL OR dest = 'external_customer' THEN RETURN NEW; END IF;

  SELECT name INTO prod_name FROM feed_products WHERE id = NEW.feed_product_id;
  IF prod_name IS NULL THEN RETURN NEW; END IF;

  IF dest = 'brooding_feed_store' THEN
    br_id := ensure_brooding_feed_row(prod_name);
    BEGIN
      INSERT INTO brooding_feed_stock_movements(
        feed_id, movement_type, quantity_kg, unit_cost, total_cost,
        notes, source_type, source_id, invoice_no, created_by)
      VALUES (br_id, 'factory_supply', NEW.quantity, NEW.unit_cost,
              NEW.quantity * NEW.unit_cost,
              'وارد من مصنع العلف — فاتورة ' || COALESCE(v_sale_no,''),
              'feed_factory_invoice', NEW.id, v_sale_no, auth.uid());
    EXCEPTION WHEN unique_violation THEN NULL; END;
  ELSIF dest = 'slaughterhouse_feed_store' THEN
    sl_id := ensure_slaughter_feed_row(NEW.feed_product_id, prod_name);
    BEGIN
      INSERT INTO slaughterhouse_feed_movements(
        feed_id, movement_type, quantity_kg, unit_cost, total_cost,
        notes, source_type, source_id, invoice_no, performed_by)
      VALUES (sl_id, 'factory_supply', NEW.quantity, NEW.unit_cost,
              NEW.quantity * NEW.unit_cost,
              'وارد من مصنع العلف — فاتورة ' || COALESCE(v_sale_no,''),
              'feed_factory_invoice', NEW.id, v_sale_no, auth.uid());
    EXCEPTION WHEN unique_violation THEN NULL; END;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_feed_sale_item_route_internal ON public.feed_sale_items;
CREATE TRIGGER trg_feed_sale_item_route_internal
  AFTER INSERT ON public.feed_sale_items
  FOR EACH ROW EXECUTE FUNCTION public.feed_sale_item_route_internal();

-- 9) View تقارير موحّدة
CREATE OR REPLACE VIEW public.v_feed_factory_distribution AS
SELECT
  s.id AS sale_id, s.sale_no, s.sale_date, s.destination_type,
  CASE s.destination_type
    WHEN 'external_customer' THEN COALESCE(s.customer,'عميل خارجي')
    WHEN 'brooding_feed_store' THEN 'حضانات تسمين الكتاكيت'
    WHEN 'slaughterhouse_feed_store' THEN 'مخزن علف المجزر'
  END AS destination_label,
  i.id AS item_id, i.feed_product_id, fp.name AS feed_name,
  i.quantity, i.unit_price, i.unit_cost, i.line_total, i.line_cost,
  s.salesperson, s.notes
FROM feed_sales s
JOIN feed_sale_items i ON i.sale_id = s.id
LEFT JOIN feed_products fp ON fp.id = i.feed_product_id
WHERE i.feed_product_id IS NOT NULL;

GRANT SELECT ON public.v_feed_factory_distribution TO authenticated;
