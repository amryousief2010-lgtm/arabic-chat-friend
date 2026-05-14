
-- 1) New roles for Sugar in Space catering operations
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'catering_sales_b2c';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'catering_sales_b2b';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'kitchen_manager';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'pastry_chef';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'dessert_chef';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'hot_food_chef';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'salad_chef';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'procurement_manager';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'cost_accountant';

-- =========================================================
-- 2) Customers (B2C / B2B)
-- =========================================================
CREATE TABLE public.catering_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  customer_type text NOT NULL DEFAULT 'individual', -- individual | company
  phone text NOT NULL,
  phone2 text,
  email text,
  city text,
  address text,
  tax_number text,
  payment_terms text DEFAULT 'on_delivery', -- on_delivery | net_15 | net_30 | prepaid
  notes text,
  total_orders int NOT NULL DEFAULT 0,
  total_spent numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_customers ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 3) Suppliers
-- =========================================================
CREATE TABLE public.catering_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  payment_terms text DEFAULT 'cash',
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_suppliers ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 4) Raw materials (المواد الخام)
-- =========================================================
CREATE TABLE public.catering_raw_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  unit text NOT NULL DEFAULT 'كجم',
  unit_cost numeric NOT NULL DEFAULT 0,
  stock numeric NOT NULL DEFAULT 0,
  low_stock_threshold numeric NOT NULL DEFAULT 5,
  supplier_id uuid REFERENCES public.catering_suppliers(id) ON DELETE SET NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_raw_materials ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 5) Finished products (للبيع)
-- =========================================================
CREATE TABLE public.catering_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  image_url text,
  kitchen_section text NOT NULL DEFAULT 'pastry', -- pastry | dessert | hot | salad
  category text,
  unit text NOT NULL DEFAULT 'قطعة',
  computed_cost numeric NOT NULL DEFAULT 0,         -- محسوبة من الوصفة
  sale_price numeric NOT NULL DEFAULT 0,
  market_price_low numeric,
  market_price_avg numeric,
  market_price_high numeric,
  ai_suggested_price numeric,
  ai_reasoning text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_products ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 6) Product recipe items (BOM)
-- =========================================================
CREATE TABLE public.catering_product_recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.catering_products(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.catering_raw_materials(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_product_recipe_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_recipe_items_product ON public.catering_product_recipe_items(product_id);

-- =========================================================
-- 7) Catering orders + items
-- =========================================================
CREATE TABLE public.catering_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  customer_id uuid REFERENCES public.catering_customers(id) ON DELETE SET NULL,
  customer_name_snapshot text NOT NULL,
  sales_team text NOT NULL DEFAULT 'b2c', -- b2c | b2b
  delivery_address text,
  delivery_date date,
  delivery_time time,
  kitchen_out_time time,
  serving_time time,
  customer_notes text,
  internal_notes text,
  payment_method text NOT NULL DEFAULT 'bank_transfer', -- bank_transfer | cash | credit
  payment_status text NOT NULL DEFAULT 'pending',       -- pending | paid | partial | overdue
  status text NOT NULL DEFAULT 'new',                   -- new | in_kitchen | ready | dispatched | delivered | cancelled
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  delivery_fee numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.catering_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.catering_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.catering_products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  product_image text,
  kitchen_section text NOT NULL DEFAULT 'pastry',
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total_price numeric NOT NULL DEFAULT 0,
  prep_status text NOT NULL DEFAULT 'pending', -- pending | preparing | ready
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_order_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_catering_order_items_order ON public.catering_order_items(order_id);
CREATE INDEX idx_catering_order_items_section ON public.catering_order_items(kitchen_section);

-- =========================================================
-- 8) Purchase orders
-- =========================================================
CREATE TABLE public.catering_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL UNIQUE,
  supplier_id uuid REFERENCES public.catering_suppliers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft', -- draft | sent | received | cancelled
  total numeric NOT NULL DEFAULT 0,
  delivery_to text NOT NULL DEFAULT 'warehouse', -- warehouse | kitchen
  notes text,
  related_order_id uuid REFERENCES public.catering_orders(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.catering_purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.catering_purchase_orders(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.catering_raw_materials(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  received_qty numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_purchase_order_items ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 9) Inventory movements (raw materials)
-- =========================================================
CREATE TABLE public.catering_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id uuid NOT NULL REFERENCES public.catering_raw_materials(id) ON DELETE CASCADE,
  movement_type text NOT NULL, -- in | out | adjustment
  quantity numeric NOT NULL,
  unit_cost numeric DEFAULT 0,
  reference text,
  related_order_id uuid REFERENCES public.catering_orders(id) ON DELETE SET NULL,
  related_po_id uuid REFERENCES public.catering_purchase_orders(id) ON DELETE SET NULL,
  notes text,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_inventory_movements ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 10) Manufacturing invoices (فواتير التصنيع)
-- =========================================================
CREATE TABLE public.catering_manufacturing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  product_id uuid NOT NULL REFERENCES public.catering_products(id) ON DELETE RESTRICT,
  batch_quantity numeric NOT NULL DEFAULT 1,
  materials_cost numeric NOT NULL DEFAULT 0,
  labor_cost numeric NOT NULL DEFAULT 0,
  overhead_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_manufacturing_invoices ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 11) Sales invoices (فواتير البيع للعميل)
-- =========================================================
CREATE TABLE public.catering_sales_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES public.catering_orders(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.catering_customers(id) ON DELETE SET NULL,
  total numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'bank_transfer',
  payment_status text NOT NULL DEFAULT 'pending',
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catering_sales_invoices ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- Triggers: updated_at
-- =========================================================
CREATE TRIGGER trg_catering_customers_upd BEFORE UPDATE ON public.catering_customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_catering_suppliers_upd BEFORE UPDATE ON public.catering_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_catering_raw_materials_upd BEFORE UPDATE ON public.catering_raw_materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_catering_products_upd BEFORE UPDATE ON public.catering_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_catering_orders_upd BEFORE UPDATE ON public.catering_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_catering_pos_upd BEFORE UPDATE ON public.catering_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_catering_sales_inv_upd BEFORE UPDATE ON public.catering_sales_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- RLS policies (referencing only existing enum values to avoid
-- "unsafe use of new value" inside the same migration)
-- =========================================================

-- Customers
CREATE POLICY "view catering customers (auth)" ON public.catering_customers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage catering customers (managers)" ON public.catering_customers
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

-- Suppliers
CREATE POLICY "view suppliers (auth)" ON public.catering_suppliers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage suppliers (managers)" ON public.catering_suppliers
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]));

-- Raw materials
CREATE POLICY "view raw materials (auth)" ON public.catering_raw_materials
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage raw materials (managers)" ON public.catering_raw_materials
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]));

-- Products
CREATE POLICY "view products (auth)" ON public.catering_products
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage products (managers)" ON public.catering_products
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role]));

-- Recipe items
CREATE POLICY "view recipe items (auth)" ON public.catering_product_recipe_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage recipe items (managers)" ON public.catering_product_recipe_items
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role]));

-- Catering orders
CREATE POLICY "view catering orders (auth)" ON public.catering_orders
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "create catering orders (sales)" ON public.catering_orders
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'sales_moderator'::app_role,'marketing_sales_manager'::app_role]));
CREATE POLICY "update catering orders (managers)" ON public.catering_orders
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role,'warehouse_supervisor'::app_role]));
CREATE POLICY "delete catering orders (managers)" ON public.catering_orders
  FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]));

-- Order items
CREATE POLICY "view catering order items (auth)" ON public.catering_order_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage catering order items (sales)" ON public.catering_order_items
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'sales_moderator'::app_role,'marketing_sales_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'sales_moderator'::app_role,'marketing_sales_manager'::app_role]));

-- Purchase orders
CREATE POLICY "view purchase orders (auth)" ON public.catering_purchase_orders
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage purchase orders (managers)" ON public.catering_purchase_orders
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]));

CREATE POLICY "view po items (auth)" ON public.catering_purchase_order_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage po items (managers)" ON public.catering_purchase_order_items
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]));

-- Inventory movements
CREATE POLICY "view inv movements (auth)" ON public.catering_inventory_movements
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage inv movements (managers)" ON public.catering_inventory_movements
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]));

-- Manufacturing invoices
CREATE POLICY "view mfg invoices (auth)" ON public.catering_manufacturing_invoices
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage mfg invoices (managers)" ON public.catering_manufacturing_invoices
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]));

-- Sales invoices
CREATE POLICY "view sales invoices (auth)" ON public.catering_sales_invoices
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage sales invoices (managers)" ON public.catering_sales_invoices
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]));
