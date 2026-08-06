-- 1) Generic merge utility
CREATE OR REPLACE FUNCTION public.merge_inventory_items(p_source uuid, p_canonical uuid, p_ref text DEFAULT 'AUTO-MERGE')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s public.inventory_items%ROWTYPE;
  c public.inventory_items%ROWTYPE;
  v_moved int := 0;
BEGIN
  IF p_source = p_canonical THEN RETURN; END IF;
  SELECT * INTO s FROM public.inventory_items WHERE id = p_source;
  SELECT * INTO c FROM public.inventory_items WHERE id = p_canonical;
  IF s.id IS NULL OR c.id IS NULL THEN RETURN; END IF;
  IF s.warehouse_id <> c.warehouse_id THEN
    RAISE EXCEPTION 'لا يمكن الدمج بين مخازن مختلفة';
  END IF;

  UPDATE public.inventory_movements SET item_id = c.id WHERE item_id = s.id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  UPDATE public.slaughter_batch_outputs SET received_inventory_item_id = c.id WHERE received_inventory_item_id = s.id;
  UPDATE public.warehouse_transfer_items SET source_item_id = c.id WHERE source_item_id = s.id;
  UPDATE public.warehouse_transfer_items SET destination_item_id = c.id WHERE destination_item_id = s.id;
  UPDATE public.meat_factory_raw_materials SET inventory_item_id = c.id WHERE inventory_item_id = s.id;
  UPDATE public.feed_raw_materials SET inventory_item_id = c.id WHERE inventory_item_id = s.id;
  UPDATE public.packaging_materials SET inventory_item_id = c.id WHERE inventory_item_id = s.id;
  UPDATE public.meat_factory_products SET inventory_item_id = c.id WHERE inventory_item_id = s.id;
  UPDATE public.feed_products SET inventory_item_id = c.id WHERE inventory_item_id = s.id;
  UPDATE public.meat_manufacturing_invoices SET finished_item_id = c.id WHERE finished_item_id = s.id;
  UPDATE public.stocktaking_lines SET item_id = c.id WHERE item_id = s.id;

  UPDATE public.inventory_items
     SET stock = COALESCE(c.stock,0) + COALESCE(s.stock,0),
         reserved_qty = COALESCE(c.reserved_qty,0) + COALESCE(s.reserved_qty,0),
         product_id = COALESCE(c.product_id, s.product_id),
         updated_at = now()
   WHERE id = c.id;

  UPDATE public.inventory_items
     SET stock = 0, reserved_qty = 0, blocked_qty = 0, is_active = false,
         product_id = NULL,
         name = s.name || ' (مدمج)',
         notes = COALESCE(s.notes,'') || ' [مدمج في ' || c.name || ']',
         updated_at = now()
   WHERE id = s.id;

  INSERT INTO public.inventory_item_merge_log(
    merge_ref, canonical_item_id, source_item_id, source_name, canonical_name,
    source_stock_before, canonical_stock_before, canonical_stock_after, moved_movements)
  VALUES (p_ref, c.id, s.id, s.name, c.name,
          COALESCE(s.stock,0), COALESCE(c.stock,0), COALESCE(c.stock,0)+COALESCE(s.stock,0), v_moved);
END;
$$;

-- 2) One-time cleanup of all existing duplicates (per warehouse + canonical name)
DO $$
DECLARE
  g RECORD;
  it RECORD;
  v_canon uuid;
BEGIN
  FOR g IN
    SELECT warehouse_id, public.canonical_wh_item_name(name) AS key
    FROM public.inventory_items
    WHERE is_active
    GROUP BY 1,2
    HAVING count(*) > 1
  LOOP
    v_canon := NULL;
    FOR it IN
      SELECT id FROM public.inventory_items
      WHERE is_active AND warehouse_id = g.warehouse_id
        AND public.canonical_wh_item_name(name) = g.key
      ORDER BY (product_id IS NOT NULL) DESC, COALESCE(stock,0) DESC, created_at ASC
    LOOP
      IF v_canon IS NULL THEN
        v_canon := it.id;
      ELSE
        PERFORM public.merge_inventory_items(it.id, v_canon, 'DUP-CLEANUP-20260806');
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- 3) Hard guard: no two active cards with the same canonical name in one warehouse
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_canonical_name
  ON public.inventory_items (warehouse_id, public.canonical_wh_item_name(name))
  WHERE is_active;

CREATE OR REPLACE FUNCTION public.guard_inventory_item_duplicate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_existing text;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN RETURN NEW; END IF;
  SELECT name INTO v_existing
  FROM public.inventory_items
  WHERE warehouse_id = NEW.warehouse_id
    AND is_active
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND public.canonical_wh_item_name(name) = public.canonical_wh_item_name(NEW.name)
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'يوجد بالفعل صنف بنفس الاسم في هذا المخزن: "%" — استخدم الكارت الموجود بدل إنشاء كارت جديد', v_existing;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_inventory_item_duplicate ON public.inventory_items;
CREATE TRIGGER trg_guard_inventory_item_duplicate
BEFORE INSERT OR UPDATE OF name, is_active, warehouse_id ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_item_duplicate();

-- 4) Safe get-or-create used by app flows
CREATE OR REPLACE FUNCTION public.get_or_create_wh_item(
  p_warehouse_id uuid,
  p_name text,
  p_unit text DEFAULT 'كجم',
  p_category text DEFAULT NULL,
  p_module text DEFAULT NULL,
  p_product_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  v_id := public.resolve_wh_item_by_name(p_warehouse_id, p_name);
  IF v_id IS NOT NULL THEN
    UPDATE public.inventory_items
       SET is_active = true,
           product_id = COALESCE(product_id, p_product_id),
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.inventory_items(warehouse_id, name, unit, category, module, product_id, stock)
  VALUES (p_warehouse_id, btrim(p_name), COALESCE(p_unit,'كجم'), p_category, p_module, p_product_id, 0)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_wh_item(uuid, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_inventory_items(uuid, uuid, text) TO service_role;