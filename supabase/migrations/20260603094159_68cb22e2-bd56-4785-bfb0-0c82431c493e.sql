
-- 1) Packaging stock movements log
CREATE TABLE IF NOT EXISTS public.packaging_stock_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packaging_id uuid NOT NULL REFERENCES public.packaging_materials(id),
  packaging_name text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('IN','OUT')),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0,
  reason text,
  ref_table text,
  ref_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.packaging_stock_moves TO authenticated;
GRANT ALL ON public.packaging_stock_moves TO service_role;

ALTER TABLE public.packaging_stock_moves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "packaging_moves_read" ON public.packaging_stock_moves FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role,'meat_factory_manager'::app_role,'feed_factory_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]));

CREATE POLICY "packaging_moves_insert" ON public.packaging_stock_moves FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'warehouse_supervisor'::app_role,'meat_factory_manager'::app_role,'feed_factory_manager'::app_role]));

-- 2) Packaging lines on a meat manufacturing invoice
CREATE TABLE IF NOT EXISTS public.meat_factory_manufacturing_packaging_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturing_id uuid NOT NULL REFERENCES public.meat_factory_manufacturing(id) ON DELETE CASCADE,
  packaging_id uuid NOT NULL REFERENCES public.packaging_materials(id),
  packaging_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_manufacturing_packaging_lines TO authenticated;
GRANT ALL ON public.meat_factory_manufacturing_packaging_lines TO service_role;

ALTER TABLE public.meat_factory_manufacturing_packaging_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meat_mfg_pkg_all" ON public.meat_factory_manufacturing_packaging_lines
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'meat_factory_manager'::app_role,'warehouse_supervisor'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'meat_factory_manager'::app_role,'warehouse_supervisor'::app_role]));

CREATE INDEX IF NOT EXISTS idx_meat_mfg_pkg_lines_mfg ON public.meat_factory_manufacturing_packaging_lines(manufacturing_id);

-- 3) Replace approve_meat_manufacturing to deduct packaging too
CREATE OR REPLACE FUNCTION public.approve_meat_manufacturing(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m RECORD; v_line RECORD; v_pkg RECORD;
  v_total NUMERIC := 0;
  v_old_stock NUMERIC; v_old_cost NUMERIC; v_new_avg NUMERIC;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
      OR has_role(auth.uid(),'meat_factory_manager') OR has_role(auth.uid(),'warehouse_supervisor')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  SELECT * INTO v_m FROM meat_factory_manufacturing WHERE id=p_id FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF v_m.status='approved' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;

  -- check raw availability
  FOR v_line IN SELECT * FROM meat_factory_manufacturing_lines WHERE manufacturing_id=p_id LOOP
    SELECT current_stock INTO v_old_stock FROM meat_factory_raw_items WHERE id=v_line.raw_item_id FOR UPDATE;
    IF v_old_stock < v_line.quantity THEN
      RAISE EXCEPTION 'الخامة % غير كافية (المتاح %, المطلوب %)', v_line.raw_item_name, v_old_stock, v_line.quantity;
    END IF;
  END LOOP;

  -- check packaging availability
  FOR v_pkg IN SELECT * FROM meat_factory_manufacturing_packaging_lines WHERE manufacturing_id=p_id LOOP
    SELECT stock INTO v_old_stock FROM packaging_materials WHERE id=v_pkg.packaging_id FOR UPDATE;
    IF v_old_stock IS NULL OR v_old_stock < v_pkg.quantity THEN
      RAISE EXCEPTION 'مادة التغليف % غير كافية (المتاح %, المطلوب %)', v_pkg.packaging_name, COALESCE(v_old_stock,0), v_pkg.quantity;
    END IF;
  END LOOP;

  -- deduct raws & compute cost
  FOR v_line IN SELECT * FROM meat_factory_manufacturing_lines WHERE manufacturing_id=p_id LOOP
    SELECT current_stock, avg_cost INTO v_old_stock, v_old_cost FROM meat_factory_raw_items WHERE id=v_line.raw_item_id;
    UPDATE meat_factory_manufacturing_lines SET unit_cost=v_old_cost, line_total=v_line.quantity*v_old_cost WHERE id=v_line.id;
    v_total := v_total + (v_line.quantity*v_old_cost);
    UPDATE meat_factory_raw_items SET current_stock=v_old_stock-v_line.quantity, updated_at=now() WHERE id=v_line.raw_item_id;
    INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
      VALUES('raw',v_line.raw_item_id,v_line.raw_item_name,'OUT',v_line.quantity,v_old_cost,'استهلاك تصنيع','meat_factory_manufacturing',p_id,auth.uid());
  END LOOP;

  -- deduct packaging from packaging warehouse & add to cost
  FOR v_pkg IN SELECT * FROM meat_factory_manufacturing_packaging_lines WHERE manufacturing_id=p_id LOOP
    SELECT stock, unit_cost INTO v_old_stock, v_old_cost FROM packaging_materials WHERE id=v_pkg.packaging_id;
    UPDATE meat_factory_manufacturing_packaging_lines
       SET unit_cost=v_old_cost, line_total=v_pkg.quantity*v_old_cost
     WHERE id=v_pkg.id;
    v_total := v_total + (v_pkg.quantity*v_old_cost);
    UPDATE packaging_materials SET stock=v_old_stock-v_pkg.quantity, updated_at=now() WHERE id=v_pkg.packaging_id;
    INSERT INTO packaging_stock_moves(packaging_id,packaging_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
      VALUES(v_pkg.packaging_id,v_pkg.packaging_name,'OUT',v_pkg.quantity,v_old_cost,'استخدام في تصنيع مصنع اللحوم - '||COALESCE(v_m.invoice_number,''),'meat_factory_manufacturing',p_id,auth.uid());
  END LOOP;

  -- add finished product
  SELECT current_stock, avg_cost INTO v_old_stock, v_old_cost FROM meat_factory_finished_items WHERE id=v_m.finished_item_id FOR UPDATE;
  v_new_avg := CASE WHEN (v_old_stock + v_m.produced_qty)=0 THEN (v_total/NULLIF(v_m.produced_qty,0))
                    ELSE ((v_old_stock*v_old_cost)+v_total)/(v_old_stock+v_m.produced_qty) END;
  UPDATE meat_factory_finished_items SET current_stock=v_old_stock+v_m.produced_qty, avg_cost=v_new_avg, updated_at=now()
    WHERE id=v_m.finished_item_id;

  INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
    VALUES('finished',v_m.finished_item_id,v_m.finished_item_name,'IN',v_m.produced_qty, v_total/NULLIF(v_m.produced_qty,0),'إنتاج تصنيع','meat_factory_manufacturing',p_id,auth.uid());

  UPDATE meat_factory_manufacturing
     SET status='approved', approved_at=now(), approved_by=auth.uid(),
         total_cost=v_total, unit_cost=v_total/NULLIF(v_m.produced_qty,0)
   WHERE id=p_id;
  RETURN p_id;
END $function$;
