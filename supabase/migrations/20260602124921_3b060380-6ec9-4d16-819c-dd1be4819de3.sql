
-- =====================================================================
-- Opening Balance + Main Warehouse Movement Discipline (v2)
-- =====================================================================

-- 0) Extend allowed movement types
ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_movement_type_check CHECK (
    movement_type = ANY (ARRAY[
      'in','out','transfer','adjustment','adjust',
      'purchase_receipt','stock_in','stock_out',
      'production_consumption','packaging_consumption','finished_goods_receipt',
      'reconciliation','return','waste_loss',
      'sales_dispatch','sales_return',
      'opening_balance'
    ])
  );

-- 1) Opening Balances table
CREATE TABLE IF NOT EXISTS public.warehouse_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL,
  item_id uuid NOT NULL,
  product_id uuid,
  qty numeric NOT NULL DEFAULT 0,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid,
  notes text,
  UNIQUE (warehouse_id, item_id, opened_at)
);

GRANT SELECT ON public.warehouse_opening_balances TO authenticated;
GRANT ALL ON public.warehouse_opening_balances TO service_role;

ALTER TABLE public.warehouse_opening_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "opening_balances_select_authenticated" ON public.warehouse_opening_balances;
CREATE POLICY "opening_balances_select_authenticated"
ON public.warehouse_opening_balances FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "opening_balances_admin_write" ON public.warehouse_opening_balances;
CREATE POLICY "opening_balances_admin_write"
ON public.warehouse_opening_balances FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager'))
WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager'));

-- 2) Snapshot CURRENT main-warehouse inventory as the opening balance
INSERT INTO public.warehouse_opening_balances (warehouse_id, item_id, product_id, qty, opened_at, notes)
SELECT
  ii.warehouse_id, ii.id, ii.product_id,
  COALESCE(ii.stock, 0), now(),
  'Opening balance — تثبيت الجرد اليدوي كنقطة صفر للمخزن الرئيسي'
FROM public.inventory_items ii
WHERE ii.warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c'
ON CONFLICT DO NOTHING;

-- 3) Record an opening_balance movement for each item
INSERT INTO public.inventory_movements (
  item_id, warehouse_id, movement_type, quantity, unit_cost,
  reference_type, reference_id, module, reason, product_id, performed_at
)
SELECT
  ii.id, ii.warehouse_id, 'opening_balance', COALESCE(ii.stock,0),
  COALESCE(ii.unit_cost,0),
  'opening_balance', ii.id::text, ii.module,
  'رصيد افتتاحي — تم تثبيت الجرد اليدوي للمخزن الرئيسي كنقطة صفر',
  ii.product_id, now()
FROM public.inventory_items ii
WHERE ii.warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c';

-- 4) Remove duplicate trigger (double deduction)
DROP TRIGGER IF EXISTS trg_order_item_insert ON public.order_items;

-- 5) Remove premature auto-dispatch flag
DROP TRIGGER IF EXISTS trg_mark_order_dispatched_on_item ON public.order_items;

-- 6) deduct_stock_on_order_item: no longer touches inventory_items
CREATE OR REPLACE FUNCTION public.deduct_stock_on_order_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_status text;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO v_status FROM public.orders WHERE id = NEW.order_id;
  IF v_status IS NULL OR v_status = 'cancelled' THEN RETURN NEW; END IF;
  UPDATE public.products
     SET stock = GREATEST(stock - NEW.quantity::int, 0)
   WHERE id = NEW.product_id;
  RETURN NEW;
END;
$function$;

-- 7) handle_order_status_stock: only return inventory if was dispatched
CREATE OR REPLACE FUNCTION public.handle_order_status_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_item record; v_oi record; v_result jsonb; v_was_dispatched boolean;
BEGIN
  v_was_dispatched := COALESCE(OLD.stock_status,'') = 'dispatched';

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p SET stock = stock + oi2.quantity::int
      FROM public.order_items oi2
      WHERE oi2.order_id = NEW.id AND oi2.product_id = p.id;

    IF v_was_dispatched
       AND COALESCE(NEW.source_warehouse_id, OLD.source_warehouse_id) IS NOT NULL THEN
      FOR v_oi IN SELECT product_id, quantity FROM public.order_items
                  WHERE order_id = NEW.id AND product_id IS NOT NULL
      LOOP
        SELECT * INTO v_item FROM public.inventory_items
          WHERE warehouse_id = COALESCE(NEW.source_warehouse_id, OLD.source_warehouse_id)
            AND product_id = v_oi.product_id
          ORDER BY stock ASC NULLS LAST LIMIT 1;
        IF v_item.id IS NOT NULL THEN
          UPDATE public.inventory_items
            SET stock = stock + v_oi.quantity, last_movement_date = now()
            WHERE id = v_item.id;
          INSERT INTO public.inventory_movements(
            item_id, warehouse_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, module, reason, product_id
          ) VALUES (
            v_item.id, v_item.warehouse_id, 'sales_return', v_oi.quantity,
            COALESCE(v_item.unit_cost,0), 'order', NEW.id::text, v_item.module,
            'إرجاع تلقائي عند إلغاء طلب مصروف', v_oi.product_id
          );
        END IF;
      END LOOP;
      NEW.stock_status := 'returned';
    ELSE
      NEW.stock_status := 'not_dispatched';
    END IF;
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p SET stock = GREATEST(stock - oi2.quantity::int, 0)
      FROM public.order_items oi2
      WHERE oi2.order_id = NEW.id AND oi2.product_id = p.id;

    IF COALESCE(OLD.stock_status,'') = 'returned' AND NEW.source_warehouse_id IS NOT NULL THEN
      FOR v_oi IN SELECT product_id, quantity FROM public.order_items
                  WHERE order_id = NEW.id AND product_id IS NOT NULL
      LOOP
        SELECT * INTO v_item FROM public.inventory_items
          WHERE warehouse_id = NEW.source_warehouse_id
            AND product_id = v_oi.product_id
          ORDER BY stock DESC NULLS LAST LIMIT 1;
        IF v_item.id IS NOT NULL THEN
          UPDATE public.inventory_items
            SET stock = stock - v_oi.quantity, last_movement_date = now()
            WHERE id = v_item.id;
          INSERT INTO public.inventory_movements(
            item_id, warehouse_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, module, reason, product_id
          ) VALUES (
            v_item.id, v_item.warehouse_id, 'sales_dispatch', -v_oi.quantity,
            COALESCE(v_item.unit_cost,0), 'order', NEW.id::text, v_item.module,
            'إعادة سحب بعد التراجع عن الإلغاء', v_oi.product_id
          );
        END IF;
      END LOOP;
      NEW.stock_status := 'dispatched';
    END IF;
  END IF;

  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    IF COALESCE(NEW.stock_status,'not_dispatched') <> 'dispatched'
       AND NEW.source_warehouse_id IS NOT NULL THEN
      BEGIN
        v_result := public.dispatch_order_stock(NEW.id);
        NEW.stock_status := 'dispatched';
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 8) return_stock_on_order_delete: only restore inventory if was dispatched
CREATE OR REPLACE FUNCTION public.return_stock_on_order_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; v_item record;
BEGIN
  IF OLD.status = 'cancelled' THEN RETURN OLD; END IF;

  -- Restore legacy products.stock (mirrors deduct on insert)
  UPDATE public.products p
     SET stock = stock + x.quantity::int
    FROM public.order_items x
   WHERE x.order_id = OLD.id AND x.product_id = p.id;

  -- Restore inventory_items only if was dispatched
  IF COALESCE(OLD.stock_status,'') = 'dispatched' AND OLD.source_warehouse_id IS NOT NULL THEN
    FOR r IN SELECT product_id, quantity FROM public.order_items
             WHERE order_id = OLD.id AND product_id IS NOT NULL
    LOOP
      SELECT * INTO v_item FROM public.inventory_items
       WHERE warehouse_id = OLD.source_warehouse_id
         AND product_id = r.product_id LIMIT 1;
      IF v_item.id IS NOT NULL THEN
        UPDATE public.inventory_items
           SET stock = COALESCE(stock,0) + r.quantity, last_movement_date = now()
         WHERE id = v_item.id;
        INSERT INTO public.inventory_movements(
          item_id, warehouse_id, movement_type, quantity, unit_cost,
          reference_type, reference_id, module, reason, product_id
        ) VALUES (
          v_item.id, v_item.warehouse_id, 'sales_return', r.quantity,
          COALESCE(v_item.unit_cost,0), 'order', OLD.id::text, v_item.module,
          'إرجاع تلقائي عند حذف طلب مصروف', r.product_id
        );
      END IF;
    END LOOP;
  END IF;
  RETURN OLD;
END;
$function$;

-- 9) Manager-only stock adjustment RPC
CREATE OR REPLACE FUNCTION public.adjust_main_warehouse_stock(
  p_item_id uuid, p_new_qty numeric, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_item record; v_diff numeric; v_uid uuid := auth.uid();
BEGIN
  IF NOT (public.has_role(v_uid,'general_manager') OR public.has_role(v_uid,'executive_manager')) THEN
    RAISE EXCEPTION 'permission denied: manager role required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'سبب التعديل مطلوب';
  END IF;
  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
  v_diff := p_new_qty - COALESCE(v_item.stock,0);
  UPDATE public.inventory_items
     SET stock = p_new_qty, last_movement_date = now()
   WHERE id = p_item_id;
  INSERT INTO public.inventory_movements(
    item_id, warehouse_id, movement_type, quantity, unit_cost,
    reference_type, reference_id, module, reason, product_id, performed_by, performed_at
  ) VALUES (
    p_item_id, v_item.warehouse_id, 'adjust', v_diff,
    COALESCE(v_item.unit_cost,0), 'manual_adjust', p_item_id::text, v_item.module,
    p_reason, v_item.product_id, v_uid, now()
  );
  RETURN jsonb_build_object('ok', true, 'diff', v_diff, 'new_stock', p_new_qty);
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_main_warehouse_stock(uuid, numeric, text) TO authenticated;
