
-- 1) Sublocations table
CREATE TABLE public.warehouse_sublocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_sublocations TO authenticated;
GRANT ALL ON public.warehouse_sublocations TO service_role;
ALTER TABLE public.warehouse_sublocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sublocations" ON public.warehouse_sublocations FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write sublocations" ON public.warehouse_sublocations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) Per-sublocation stock
CREATE TABLE public.inventory_sublocation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sublocation_id UUID NOT NULL REFERENCES public.warehouse_sublocations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  stock NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sublocation_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_sublocation_items TO authenticated;
GRANT ALL ON public.inventory_sublocation_items TO service_role;
ALTER TABLE public.inventory_sublocation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sub items" ON public.inventory_sublocation_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write sub items" ON public.inventory_sublocation_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3) Movement log
CREATE TABLE public.sublocation_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  from_sublocation_id UUID NOT NULL REFERENCES public.warehouse_sublocations(id),
  to_sublocation_id UUID NOT NULL REFERENCES public.warehouse_sublocations(id),
  qty NUMERIC NOT NULL CHECK (qty > 0),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.sublocation_movements TO authenticated;
GRANT ALL ON public.sublocation_movements TO service_role;
ALTER TABLE public.sublocation_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sub moves" ON public.sublocation_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert sub moves" ON public.sublocation_movements FOR INSERT TO authenticated WITH CHECK (true);

-- 4) updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_sublocation_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_sub_touch_1 BEFORE UPDATE ON public.warehouse_sublocations
  FOR EACH ROW EXECUTE FUNCTION public.tg_sublocation_touch();
CREATE TRIGGER trg_sub_touch_2 BEFORE UPDATE ON public.inventory_sublocation_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_sublocation_touch();

-- 5) Transfer RPC
CREATE OR REPLACE FUNCTION public.transfer_between_sublocations(
  p_product_id UUID,
  p_from_sublocation_id UUID,
  p_to_sublocation_id UUID,
  p_qty NUMERIC,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from_stock NUMERIC;
  v_move_id UUID;
  v_from_wh UUID;
  v_to_wh UUID;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر';
  END IF;
  IF p_from_sublocation_id = p_to_sublocation_id THEN
    RAISE EXCEPTION 'لا يمكن النقل إلى نفس المكان';
  END IF;

  SELECT warehouse_id INTO v_from_wh FROM public.warehouse_sublocations WHERE id = p_from_sublocation_id;
  SELECT warehouse_id INTO v_to_wh FROM public.warehouse_sublocations WHERE id = p_to_sublocation_id;
  IF v_from_wh IS NULL OR v_to_wh IS NULL OR v_from_wh <> v_to_wh THEN
    RAISE EXCEPTION 'المكانين يجب أن يكونا في نفس المخزن';
  END IF;

  SELECT stock INTO v_from_stock FROM public.inventory_sublocation_items
    WHERE sublocation_id = p_from_sublocation_id AND product_id = p_product_id
    FOR UPDATE;
  IF v_from_stock IS NULL THEN v_from_stock := 0; END IF;
  IF v_from_stock < p_qty THEN
    RAISE EXCEPTION 'الكمية المطلوبة (%) أكبر من المتاح في المكان (%)', p_qty, v_from_stock;
  END IF;

  UPDATE public.inventory_sublocation_items
    SET stock = stock - p_qty
    WHERE sublocation_id = p_from_sublocation_id AND product_id = p_product_id;

  INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock)
    VALUES (p_to_sublocation_id, p_product_id, p_qty)
    ON CONFLICT (sublocation_id, product_id)
    DO UPDATE SET stock = public.inventory_sublocation_items.stock + EXCLUDED.stock;

  INSERT INTO public.sublocation_movements (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by)
    VALUES (p_product_id, p_from_sublocation_id, p_to_sublocation_id, p_qty, p_notes, auth.uid())
    RETURNING id INTO v_move_id;

  RETURN v_move_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.transfer_between_sublocations(UUID, UUID, UUID, NUMERIC, TEXT) TO authenticated;

-- 6) Seed the two sublocations for the main warehouse
INSERT INTO public.warehouse_sublocations (warehouse_id, code, name_ar, sort_order)
VALUES
  ('5ec781b5-685b-4806-b59a-83a79ea5662c', 'FREEZERS', 'الفريزرات', 1),
  ('5ec781b5-685b-4806-b59a-83a79ea5662c', 'FRIDGE',   'ثلاجة التجميد', 2)
ON CONFLICT DO NOTHING;

-- 7) Seed initial distribution: put all existing main warehouse stock into "الفريزرات"
INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock)
SELECT s.id, ii.product_id, COALESCE(ii.stock, 0)
FROM public.inventory_items ii
JOIN public.warehouse_sublocations s
  ON s.warehouse_id = ii.warehouse_id AND s.code = 'FREEZERS'
WHERE ii.warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c'
  AND ii.product_id IS NOT NULL
ON CONFLICT (sublocation_id, product_id) DO NOTHING;
