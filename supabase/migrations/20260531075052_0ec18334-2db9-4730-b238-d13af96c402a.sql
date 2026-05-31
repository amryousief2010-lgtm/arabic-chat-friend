
-- 1) Expand treasury kind CHECK to include custody + expense categories
ALTER TABLE public.feed_factory_treasury_txns DROP CONSTRAINT IF EXISTS feed_factory_treasury_txns_kind_check;
ALTER TABLE public.feed_factory_treasury_txns ADD CONSTRAINT feed_factory_treasury_txns_kind_check
  CHECK (kind IN (
    'sale','purchase','loan_from_naam','loan_to_naam',
    'manual_in','manual_out','opening_balance','other',
    'custody_shoala','custody_gamal',
    'general_expense','tobacco_expense','transport_expense'
  ));

-- 2) Add transport / tobacco / other-expense columns to purchases
ALTER TABLE public.feed_raw_purchases
  ADD COLUMN IF NOT EXISTS transport_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tobacco_cost   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_expense  numeric NOT NULL DEFAULT 0;

-- 3) Update item-insert trigger to include extras in header total_amount
CREATE OR REPLACE FUNCTION public.apply_feed_raw_purchase_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_stock numeric; old_cost numeric;
  new_stock numeric; new_cost numeric;
  v_extras  numeric;
BEGIN
  NEW.line_total := COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_price,0);

  SELECT COALESCE(stock,0), COALESCE(unit_cost,0) INTO old_stock, old_cost
    FROM feed_raw_materials WHERE id = NEW.raw_material_id;

  new_stock := old_stock + NEW.quantity;
  IF new_stock > 0 THEN
    new_cost := ((old_stock*old_cost) + (NEW.quantity*NEW.unit_price)) / new_stock;
  ELSE
    new_cost := NEW.unit_price;
  END IF;

  UPDATE feed_raw_materials
     SET stock = new_stock, unit_cost = new_cost, updated_at = now()
   WHERE id = NEW.raw_material_id;

  SELECT COALESCE(transport_cost,0)+COALESCE(tobacco_cost,0)+COALESCE(other_expense,0)
    INTO v_extras FROM feed_raw_purchases WHERE id = NEW.purchase_id;

  UPDATE feed_raw_purchases
     SET total_amount = COALESCE((
            SELECT SUM(quantity*unit_price) FROM feed_raw_purchase_items WHERE purchase_id = NEW.purchase_id
         ),0) + NEW.line_total + COALESCE(v_extras,0),
         updated_at = now()
   WHERE id = NEW.purchase_id;

  RETURN NEW;
END;
$$;

-- 4) Update revert trigger to include extras
CREATE OR REPLACE FUNCTION public.revert_feed_raw_purchase_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_extras numeric;
BEGIN
  UPDATE feed_raw_materials
     SET stock = GREATEST(0, COALESCE(stock,0) - OLD.quantity), updated_at = now()
   WHERE id = OLD.raw_material_id;

  SELECT COALESCE(transport_cost,0)+COALESCE(tobacco_cost,0)+COALESCE(other_expense,0)
    INTO v_extras FROM feed_raw_purchases WHERE id = OLD.purchase_id;

  UPDATE feed_raw_purchases
     SET total_amount = COALESCE((
            SELECT SUM(quantity*unit_price) FROM feed_raw_purchase_items WHERE purchase_id = OLD.purchase_id
         ),0) + COALESCE(v_extras,0),
         updated_at = now()
   WHERE id = OLD.purchase_id;
  RETURN OLD;
END $$;

-- 5) Recompute total_amount when extras change on header
CREATE OR REPLACE FUNCTION public.recalc_feed_purchase_total_on_extras()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (COALESCE(NEW.transport_cost,0) <> COALESCE(OLD.transport_cost,0))
     OR (COALESCE(NEW.tobacco_cost,0) <> COALESCE(OLD.tobacco_cost,0))
     OR (COALESCE(NEW.other_expense,0) <> COALESCE(OLD.other_expense,0)) THEN
    NEW.total_amount := COALESCE((SELECT SUM(quantity*unit_price) FROM feed_raw_purchase_items WHERE purchase_id = NEW.id),0)
       + COALESCE(NEW.transport_cost,0) + COALESCE(NEW.tobacco_cost,0) + COALESCE(NEW.other_expense,0);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_recalc_feed_purchase_total_extras ON public.feed_raw_purchases;
CREATE TRIGGER trg_recalc_feed_purchase_total_extras
  BEFORE UPDATE ON public.feed_raw_purchases
  FOR EACH ROW EXECUTE FUNCTION public.recalc_feed_purchase_total_on_extras();

-- 6) Production invoices (feed manufacturing) — header + items
CREATE TABLE IF NOT EXISTS public.feed_production_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prod_no text NOT NULL UNIQUE DEFAULT ('PROD-' || to_char(now(),'YYMMDDHH24MISSMS')),
  prod_date date NOT NULL DEFAULT CURRENT_DATE,
  product_id uuid NOT NULL REFERENCES public.feed_products(id) ON DELETE RESTRICT,
  qty_produced numeric NOT NULL CHECK (qty_produced > 0),
  bags numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feed_production_invoice_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES public.feed_production_invoices(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.feed_raw_materials(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0,
  line_cost numeric NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_production_invoices TO authenticated;
GRANT ALL ON public.feed_production_invoices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_production_invoice_items TO authenticated;
GRANT ALL ON public.feed_production_invoice_items TO service_role;

ALTER TABLE public.feed_production_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_production_invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feed read prod invoices" ON public.feed_production_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "feed write prod invoices" ON public.feed_production_invoices FOR INSERT TO authenticated WITH CHECK (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'feed_factory_manager') OR has_role(auth.uid(),'warehouse_supervisor')
  OR has_role(auth.uid(),'production_manager')
);
CREATE POLICY "feed update prod invoices" ON public.feed_production_invoices FOR UPDATE TO authenticated USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
);
CREATE POLICY "feed delete prod invoices" ON public.feed_production_invoices FOR DELETE TO authenticated USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
);

CREATE POLICY "feed read prod items" ON public.feed_production_invoice_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "feed write prod items" ON public.feed_production_invoice_items FOR INSERT TO authenticated WITH CHECK (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'feed_factory_manager') OR has_role(auth.uid(),'warehouse_supervisor')
  OR has_role(auth.uid(),'production_manager')
);
CREATE POLICY "feed update prod items" ON public.feed_production_invoice_items FOR UPDATE TO authenticated USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
);
CREATE POLICY "feed delete prod items" ON public.feed_production_invoice_items FOR DELETE TO authenticated USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
);

-- 7) Trigger on item insert: snapshot unit_cost, deduct raw stock, accumulate cost
CREATE OR REPLACE FUNCTION public.apply_feed_production_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cost numeric; v_stock numeric;
BEGIN
  SELECT COALESCE(unit_cost,0), COALESCE(stock,0) INTO v_cost, v_stock
    FROM feed_raw_materials WHERE id = NEW.raw_material_id;
  IF v_stock < NEW.quantity THEN
    RAISE EXCEPTION 'الكمية المطلوبة من الخامة أكبر من الرصيد المتاح (% < %)', v_stock, NEW.quantity;
  END IF;
  NEW.unit_cost := v_cost;
  NEW.line_cost := NEW.quantity * v_cost;

  UPDATE feed_raw_materials
     SET stock = GREATEST(0, stock - NEW.quantity), updated_at = now()
   WHERE id = NEW.raw_material_id;

  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_apply_feed_production_item ON public.feed_production_invoice_items;
CREATE TRIGGER trg_apply_feed_production_item
  BEFORE INSERT ON public.feed_production_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_feed_production_item();

-- 8) Revert raw stock on item delete
CREATE OR REPLACE FUNCTION public.revert_feed_production_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE feed_raw_materials
     SET stock = COALESCE(stock,0) + OLD.quantity, updated_at = now()
   WHERE id = OLD.raw_material_id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_revert_feed_production_item ON public.feed_production_invoice_items;
CREATE TRIGGER trg_revert_feed_production_item
  AFTER DELETE ON public.feed_production_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.revert_feed_production_item();

-- 9) RPC: finalize production invoice — update invoice total_cost/unit_cost
--    and add qty_produced to product stock with weighted-average cost.
--    On delete of the invoice (cascade-deletes items which revert raw stock),
--    we DO NOT auto-revert finished stock — top manager edits product manually if needed.
CREATE OR REPLACE FUNCTION public.finalize_feed_production(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total numeric;
  v_qty numeric;
  v_prod uuid;
  v_old_stock numeric;
  v_old_cost numeric;
  v_new_cost numeric;
BEGIN
  SELECT COALESCE(SUM(line_cost),0) INTO v_total
    FROM feed_production_invoice_items WHERE invoice_id = _invoice_id;

  SELECT qty_produced, product_id INTO v_qty, v_prod
    FROM feed_production_invoices WHERE id = _invoice_id;

  SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost,0)
    INTO v_old_stock, v_old_cost
    FROM feed_products WHERE id = v_prod;

  IF (v_old_stock + v_qty) > 0 THEN
    v_new_cost := ((v_old_stock*v_old_cost) + v_total) / (v_old_stock + v_qty);
  ELSE
    v_new_cost := CASE WHEN v_qty>0 THEN v_total/v_qty ELSE 0 END;
  END IF;

  UPDATE feed_products
     SET current_stock = v_old_stock + v_qty,
         latest_unit_cost = v_new_cost,
         updated_at = now()
   WHERE id = v_prod;

  UPDATE feed_production_invoices
     SET total_cost = v_total,
         unit_cost = CASE WHEN v_qty>0 THEN v_total/v_qty ELSE 0 END,
         updated_at = now()
   WHERE id = _invoice_id;
END $$;
GRANT EXECUTE ON FUNCTION public.finalize_feed_production(uuid) TO authenticated;
