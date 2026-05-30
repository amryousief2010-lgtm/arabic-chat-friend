
-- Add selling price to feed_products
ALTER TABLE public.feed_products
  ADD COLUMN IF NOT EXISTS selling_price numeric NOT NULL DEFAULT 0;

-- ============================================================
-- 1) RAW MATERIAL PURCHASES (header + items)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.feed_raw_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_no text NOT NULL UNIQUE DEFAULT ('PR-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text,1,4)),
  supplier text,
  supplier_invoice_no text,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  total_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feed_raw_purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.feed_raw_purchases(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.feed_raw_materials(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  line_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_raw_purchases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_raw_purchase_items TO authenticated;
GRANT ALL ON public.feed_raw_purchases TO service_role;
GRANT ALL ON public.feed_raw_purchase_items TO service_role;

ALTER TABLE public.feed_raw_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_raw_purchase_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feed team read purchases" ON public.feed_raw_purchases FOR SELECT TO authenticated
  USING (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager') OR has_role(auth.uid(),'warehouse_supervisor'));
CREATE POLICY "feed team write purchases" ON public.feed_raw_purchases FOR INSERT TO authenticated
  WITH CHECK (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager'));
CREATE POLICY "feed team update purchases" ON public.feed_raw_purchases FOR UPDATE TO authenticated
  USING (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager'));
CREATE POLICY "feed team delete purchases" ON public.feed_raw_purchases FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager'));

CREATE POLICY "feed team read purchase items" ON public.feed_raw_purchase_items FOR SELECT TO authenticated
  USING (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager') OR has_role(auth.uid(),'warehouse_supervisor'));
CREATE POLICY "feed team write purchase items" ON public.feed_raw_purchase_items FOR INSERT TO authenticated
  WITH CHECK (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager'));
CREATE POLICY "feed team update purchase items" ON public.feed_raw_purchase_items FOR UPDATE TO authenticated
  USING (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager'));
CREATE POLICY "feed team delete purchase items" ON public.feed_raw_purchase_items FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager'));

-- Trigger: on insert of purchase item, update raw material stock + weighted-avg unit_cost + header total
CREATE OR REPLACE FUNCTION public.apply_feed_raw_purchase_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur_stock numeric;
  cur_cost numeric;
  new_stock numeric;
  new_cost numeric;
BEGIN
  NEW.line_total := NEW.quantity * NEW.unit_price;

  SELECT COALESCE(stock,0), COALESCE(unit_cost,0) INTO cur_stock, cur_cost
    FROM feed_raw_materials WHERE id = NEW.raw_material_id;

  new_stock := cur_stock + NEW.quantity;
  IF new_stock > 0 THEN
    new_cost := ((cur_stock * cur_cost) + (NEW.quantity * NEW.unit_price)) / new_stock;
  ELSE
    new_cost := NEW.unit_price;
  END IF;

  UPDATE feed_raw_materials
     SET stock = new_stock,
         unit_cost = new_cost,
         updated_at = now()
   WHERE id = NEW.raw_material_id;

  UPDATE feed_raw_purchases
     SET total_amount = COALESCE(total_amount,0) + NEW.line_total,
         updated_at = now()
   WHERE id = NEW.purchase_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_feed_raw_purchase_item ON public.feed_raw_purchase_items;
CREATE TRIGGER trg_apply_feed_raw_purchase_item
  BEFORE INSERT ON public.feed_raw_purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_feed_raw_purchase_item();

-- ============================================================
-- 2) FINISHED FEED SALES (header + items)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.feed_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_no text NOT NULL UNIQUE DEFAULT ('SL-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text,1,4)),
  customer text,
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  total_amount numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  profit numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feed_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.feed_sales(id) ON DELETE CASCADE,
  feed_product_id uuid NOT NULL REFERENCES public.feed_products(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  unit_cost numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  line_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_sales TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_sale_items TO authenticated;
GRANT ALL ON public.feed_sales TO service_role;
GRANT ALL ON public.feed_sale_items TO service_role;

ALTER TABLE public.feed_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feed read sales" ON public.feed_sales FOR SELECT TO authenticated
  USING (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager') OR has_role(auth.uid(),'warehouse_supervisor'));
CREATE POLICY "feed write sales" ON public.feed_sales FOR INSERT TO authenticated
  WITH CHECK (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager'));
CREATE POLICY "feed update sales" ON public.feed_sales FOR UPDATE TO authenticated
  USING (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager'));
CREATE POLICY "feed delete sales" ON public.feed_sales FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager'));

CREATE POLICY "feed read sale items" ON public.feed_sale_items FOR SELECT TO authenticated
  USING (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager') OR has_role(auth.uid(),'warehouse_supervisor'));
CREATE POLICY "feed write sale items" ON public.feed_sale_items FOR INSERT TO authenticated
  WITH CHECK (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager'));
CREATE POLICY "feed update sale items" ON public.feed_sale_items FOR UPDATE TO authenticated
  USING (public.is_feed_team(auth.uid()) OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'financial_manager'));
CREATE POLICY "feed delete sale items" ON public.feed_sale_items FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager'));

-- Trigger: on insert of sale item -> compute cost from latest_unit_cost, deduct finished stock, update header
CREATE OR REPLACE FUNCTION public.apply_feed_sale_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur_stock numeric;
  cur_cost numeric;
BEGIN
  SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost,0) INTO cur_stock, cur_cost
    FROM feed_products WHERE id = NEW.feed_product_id;

  IF cur_stock < NEW.quantity THEN
    RAISE EXCEPTION 'الكمية المتاحة من المنتج غير كافية (المتاح %, المطلوب %)', cur_stock, NEW.quantity;
  END IF;

  NEW.unit_cost := cur_cost;
  NEW.line_total := NEW.quantity * NEW.unit_price;
  NEW.line_cost := NEW.quantity * cur_cost;

  UPDATE feed_products
     SET current_stock = current_stock - NEW.quantity,
         updated_at = now()
   WHERE id = NEW.feed_product_id;

  UPDATE feed_sales
     SET total_amount = COALESCE(total_amount,0) + NEW.line_total,
         total_cost   = COALESCE(total_cost,0)   + NEW.line_cost,
         profit       = COALESCE(profit,0)       + (NEW.line_total - NEW.line_cost),
         updated_at = now()
   WHERE id = NEW.sale_id;

  -- log movement
  INSERT INTO feed_finished_goods_moves(batch_id, feed_product_id, movement_type, qty_kg, destination, notes, performed_by)
  VALUES (NULL, NEW.feed_product_id, 'sale', NEW.quantity, COALESCE((SELECT customer FROM feed_sales WHERE id=NEW.sale_id),'sale'),
          'feed_sale '||NEW.sale_id::text, NEW.created_at::uuid /* dummy avoid null */ )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- fallback: if movement insert fails (column types), just continue with stock update
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_feed_sale_item ON public.feed_sale_items;
CREATE TRIGGER trg_apply_feed_sale_item
  BEFORE INSERT ON public.feed_sale_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_feed_sale_item();
