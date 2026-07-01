
-- 1) Extend slaughterhouse_feed_inventory to accept raw materials
ALTER TABLE public.slaughterhouse_feed_inventory
  ADD COLUMN IF NOT EXISTS raw_material_id uuid REFERENCES public.feed_raw_materials(id);

ALTER TABLE public.slaughterhouse_feed_inventory
  ALTER COLUMN feed_product_id DROP NOT NULL;

ALTER TABLE public.slaughterhouse_feed_inventory
  DROP CONSTRAINT IF EXISTS slaughterhouse_feed_inventory_product_unique;

CREATE UNIQUE INDEX IF NOT EXISTS slaughterhouse_feed_inv_product_uniq
  ON public.slaughterhouse_feed_inventory(feed_product_id)
  WHERE feed_product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS slaughterhouse_feed_inv_raw_uniq
  ON public.slaughterhouse_feed_inventory(raw_material_id)
  WHERE raw_material_id IS NOT NULL;

ALTER TABLE public.slaughterhouse_feed_inventory
  DROP CONSTRAINT IF EXISTS slaughterhouse_feed_inv_kind_chk;
ALTER TABLE public.slaughterhouse_feed_inventory
  ADD CONSTRAINT slaughterhouse_feed_inv_kind_chk
  CHECK ((feed_product_id IS NOT NULL)::int + (raw_material_id IS NOT NULL)::int = 1);

-- 2) Helper to ensure a raw-material inventory row
CREATE OR REPLACE FUNCTION public.ensure_slaughter_feed_raw_row(_raw_material_id uuid, _name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM slaughterhouse_feed_inventory WHERE raw_material_id = _raw_material_id;
  IF _id IS NULL THEN
    INSERT INTO slaughterhouse_feed_inventory(raw_material_id, feed_name, current_kg, last_unit_cost)
    VALUES (_raw_material_id, _name, 0, 0)
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END; $$;

-- 3) Update routing trigger to handle raw materials
CREATE OR REPLACE FUNCTION public.feed_sale_item_route_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  dest text;
  v_sale_no text;
  prod_name text;
  br_id uuid;
  sl_id uuid;
BEGIN
  SELECT destination_type, sale_no INTO dest, v_sale_no FROM feed_sales WHERE id = NEW.sale_id;
  IF dest IS NULL OR dest = 'external_customer' THEN RETURN NEW; END IF;

  -- Finished feed product path (unchanged)
  IF NEW.feed_product_id IS NOT NULL THEN
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
  END IF;

  -- Raw-material path (NEW) — only route to slaughterhouse for now
  IF NEW.raw_material_id IS NOT NULL AND dest = 'slaughterhouse_feed_store' THEN
    SELECT name INTO prod_name FROM feed_raw_materials WHERE id = NEW.raw_material_id;
    IF prod_name IS NULL THEN RETURN NEW; END IF;

    sl_id := ensure_slaughter_feed_raw_row(NEW.raw_material_id, prod_name);
    BEGIN
      INSERT INTO slaughterhouse_feed_movements(
        feed_id, movement_type, quantity_kg, unit_cost, total_cost,
        notes, source_type, source_id, invoice_no, performed_by)
      VALUES (sl_id, 'factory_supply', NEW.quantity, NEW.unit_cost,
              NEW.quantity * NEW.unit_cost,
              'وارد خامة من مصنع العلف — فاتورة ' || COALESCE(v_sale_no,''),
              'feed_factory_invoice', NEW.id, v_sale_no, auth.uid());
    EXCEPTION WHEN unique_violation THEN NULL; END;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) Backfill: create the دريس row + movement for existing sale item if missing
DO $$
DECLARE
  v_item RECORD;
  v_sl_id uuid;
  v_name text;
  v_sale_no text;
BEGIN
  FOR v_item IN
    SELECT fsi.id, fsi.sale_id, fsi.raw_material_id, fsi.quantity, fsi.unit_cost
    FROM feed_sale_items fsi
    JOIN feed_sales fs ON fs.id = fsi.sale_id
    WHERE fsi.feed_product_id IS NULL
      AND fsi.raw_material_id IS NOT NULL
      AND fs.destination_type = 'slaughterhouse_feed_store'
      AND NOT EXISTS (
        SELECT 1 FROM slaughterhouse_feed_movements m
        WHERE m.source_type = 'feed_factory_invoice' AND m.source_id = fsi.id
      )
  LOOP
    SELECT name INTO v_name FROM feed_raw_materials WHERE id = v_item.raw_material_id;
    SELECT sale_no INTO v_sale_no FROM feed_sales WHERE id = v_item.sale_id;
    IF v_name IS NULL THEN CONTINUE; END IF;

    v_sl_id := ensure_slaughter_feed_raw_row(v_item.raw_material_id, v_name);

    INSERT INTO slaughterhouse_feed_movements(
      feed_id, movement_type, quantity_kg, unit_cost, total_cost,
      notes, source_type, source_id, invoice_no)
    VALUES (v_sl_id, 'factory_supply', v_item.quantity, v_item.unit_cost,
            v_item.quantity * v_item.unit_cost,
            'وارد خامة من مصنع العلف — فاتورة ' || COALESCE(v_sale_no,'') || ' (تعويض تاريخي)',
            'feed_factory_invoice', v_item.id, v_sale_no);
  END LOOP;
END $$;
