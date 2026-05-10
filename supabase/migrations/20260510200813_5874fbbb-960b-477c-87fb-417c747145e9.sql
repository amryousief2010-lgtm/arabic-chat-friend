-- =====================================================
-- جداول مصنع الأعلاف
-- =====================================================

-- المواد الخام
CREATE TABLE public.feed_raw_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'كجم',
  stock numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  low_stock_threshold numeric NOT NULL DEFAULT 100,
  supplier text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- وصفات الأعلاف (BOM)
CREATE TABLE public.feed_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  feed_type text NOT NULL,
  batch_size numeric NOT NULL DEFAULT 1000,
  unit text NOT NULL DEFAULT 'كجم',
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- بنود الوصفة
CREATE TABLE public.feed_recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.feed_recipes(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.feed_raw_materials(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_feed_recipe_items_recipe ON public.feed_recipe_items(recipe_id);

-- دفعات إنتاج العلف
CREATE TABLE public.feed_production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number text NOT NULL UNIQUE,
  recipe_id uuid NOT NULL REFERENCES public.feed_recipes(id) ON DELETE RESTRICT,
  target_quantity numeric NOT NULL,
  actual_quantity numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','cancelled')),
  total_cost numeric NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_feed_batches_status ON public.feed_production_batches(status);

-- استهلاك المواد الخام في الدفعة
CREATE TABLE public.feed_batch_consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.feed_production_batches(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.feed_raw_materials(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_feed_consumption_batch ON public.feed_batch_consumption(batch_id);

-- =====================================================
-- جداول المخازن
-- =====================================================

CREATE TABLE public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'general' CHECK (type IN ('raw_materials','finished_goods','feed','medicines','packaging','equipment','general')),
  location text,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  manager_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  name text NOT NULL,
  category text,
  sku text,
  unit text NOT NULL DEFAULT 'قطعة',
  stock numeric NOT NULL DEFAULT 0,
  low_stock_threshold numeric NOT NULL DEFAULT 10,
  unit_cost numeric NOT NULL DEFAULT 0,
  expiry_date date,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_warehouse ON public.inventory_items(warehouse_id);
CREATE INDEX idx_inventory_low_stock ON public.inventory_items(warehouse_id) WHERE stock <= low_stock_threshold;

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('in','out','transfer','adjustment')),
  quantity numeric NOT NULL,
  destination_warehouse_id uuid REFERENCES public.warehouses(id),
  reference text,
  party text,
  unit_cost numeric DEFAULT 0,
  notes text,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_movements_item ON public.inventory_movements(item_id);
CREATE INDEX idx_movements_warehouse ON public.inventory_movements(warehouse_id);
CREATE INDEX idx_movements_date ON public.inventory_movements(performed_at DESC);

-- =====================================================
-- تفعيل RLS
-- =====================================================
ALTER TABLE public.feed_raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_production_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_batch_consumption ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- صلاحيات مصنع الأعلاف
-- المدير العام/التنفيذي/مدير مصنع الأعلاف: وصول كامل
-- باقي المستخدمين: قراءة فقط
-- =====================================================

-- feed_raw_materials
CREATE POLICY "Authenticated can view raw materials"
ON public.feed_raw_materials FOR SELECT TO authenticated USING (true);

CREATE POLICY "Feed managers manage raw materials"
ON public.feed_raw_materials FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]));

-- feed_recipes
CREATE POLICY "Authenticated can view recipes"
ON public.feed_recipes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Feed managers manage recipes"
ON public.feed_recipes FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]));

-- feed_recipe_items
CREATE POLICY "Authenticated can view recipe items"
ON public.feed_recipe_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Feed managers manage recipe items"
ON public.feed_recipe_items FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]));

-- feed_production_batches
CREATE POLICY "Authenticated can view production batches"
ON public.feed_production_batches FOR SELECT TO authenticated USING (true);

CREATE POLICY "Feed managers manage batches"
ON public.feed_production_batches FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]));

-- feed_batch_consumption
CREATE POLICY "Authenticated can view batch consumption"
ON public.feed_batch_consumption FOR SELECT TO authenticated USING (true);

CREATE POLICY "Feed managers manage consumption"
ON public.feed_batch_consumption FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]));

-- =====================================================
-- صلاحيات المخازن
-- المدير العام/التنفيذي/مشرف المخزن: وصول كامل
-- باقي المستخدمين الموثقين: قراءة فقط
-- =====================================================

CREATE POLICY "Authenticated can view warehouses"
ON public.warehouses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Warehouse managers manage warehouses"
ON public.warehouses FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]));

CREATE POLICY "Authenticated can view inventory items"
ON public.inventory_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Warehouse managers manage inventory items"
ON public.inventory_items FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]));

CREATE POLICY "Authenticated can view inventory movements"
ON public.inventory_movements FOR SELECT TO authenticated USING (true);

CREATE POLICY "Warehouse managers create movements"
ON public.inventory_movements FOR INSERT TO authenticated
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]));

CREATE POLICY "Warehouse managers update movements"
ON public.inventory_movements FOR UPDATE
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role]));

CREATE POLICY "Warehouse managers delete movements"
ON public.inventory_movements FOR DELETE
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]));

-- =====================================================
-- تريغرز updated_at
-- =====================================================
CREATE TRIGGER trg_feed_raw_materials_updated BEFORE UPDATE ON public.feed_raw_materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_feed_recipes_updated BEFORE UPDATE ON public.feed_recipes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_feed_batches_updated BEFORE UPDATE ON public.feed_production_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_warehouses_updated BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_inventory_items_updated BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- تريغر تطبيق حركات المخزون على الرصيد تلقائياً
-- =====================================================
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.movement_type = 'in' THEN
    UPDATE public.inventory_items SET stock = stock + NEW.quantity WHERE id = NEW.item_id;
  ELSIF NEW.movement_type = 'out' THEN
    UPDATE public.inventory_items SET stock = stock - NEW.quantity WHERE id = NEW.item_id;
  ELSIF NEW.movement_type = 'adjustment' THEN
    UPDATE public.inventory_items SET stock = NEW.quantity WHERE id = NEW.item_id;
  ELSIF NEW.movement_type = 'transfer' THEN
    UPDATE public.inventory_items SET stock = stock - NEW.quantity WHERE id = NEW.item_id;
    -- ملاحظة: التحويل يخصم من المخزن المصدر فقط؛ يجب إنشاء حركة 'in' منفصلة في المخزن الوجهة
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_inventory_movement
AFTER INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_inventory_movement();

-- =====================================================
-- تريغر إشعار انخفاض المخزون لبنود المخزون
-- =====================================================
CREATE OR REPLACE FUNCTION public.check_inventory_low_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  warehouse_name text;
  existing_notification uuid;
BEGIN
  IF NEW.stock <= NEW.low_stock_threshold AND NEW.stock >= 0 THEN
    SELECT name INTO warehouse_name FROM public.warehouses WHERE id = NEW.warehouse_id;
    SELECT id INTO existing_notification
    FROM public.notifications
    WHERE type = 'low_stock'
      AND description LIKE '%' || NEW.name || '%'
      AND is_read = false
    LIMIT 1;
    IF existing_notification IS NULL THEN
      INSERT INTO public.notifications (title, description, type)
      VALUES (
        'تنبيه: مخزون منخفض في المخزن',
        'الصنف "' || NEW.name || '" في مخزن "' || COALESCE(warehouse_name,'-') || '" وصل إلى ' || NEW.stock || ' ' || NEW.unit || ' (الحد الأدنى: ' || NEW.low_stock_threshold || ')',
        'low_stock'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_inventory_low_stock
AFTER INSERT OR UPDATE OF stock ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.check_inventory_low_stock();