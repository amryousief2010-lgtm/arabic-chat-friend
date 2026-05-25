-- ============ Extend inventory_movements ============
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS movement_no TEXT,
  ADD COLUMN IF NOT EXISTS module TEXT,
  ADD COLUMN IF NOT EXISTS source_warehouse_id UUID REFERENCES public.warehouses(id),
  ADD COLUMN IF NOT EXISTS reference_type TEXT,
  ADD COLUMN IF NOT EXISTS reference_id TEXT,
  ADD COLUMN IF NOT EXISTS batch_id UUID,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_movement_type_check CHECK (
    movement_type = ANY (ARRAY[
      'in','out','transfer','adjustment',
      'purchase_receipt','stock_in','stock_out',
      'production_consumption','packaging_consumption',
      'finished_goods_receipt','reconciliation','return','waste_loss'
    ])
  );

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_approval_status_check CHECK (
    approval_status = ANY (ARRAY['draft','pending','posted','reversed'])
  );

CREATE INDEX IF NOT EXISTS idx_movements_module ON public.inventory_movements(module);
CREATE INDEX IF NOT EXISTS idx_movements_type ON public.inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_movements_ref ON public.inventory_movements(reference_type, reference_id);

-- Movement number generator
CREATE OR REPLACE FUNCTION public.set_inv_movement_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.movement_no IS NULL THEN
    NEW.movement_no := 'MV-' || to_char(now(),'YYYYMMDD') || '-' ||
      LPAD((nextval('inv_movement_seq'))::text, 6, '0');
  END IF;
  IF NEW.total_cost IS NULL THEN
    NEW.total_cost := COALESCE(NEW.unit_cost,0) * NEW.quantity;
  END IF;
  RETURN NEW;
END $$;

CREATE SEQUENCE IF NOT EXISTS inv_movement_seq;
DROP TRIGGER IF EXISTS trg_set_inv_movement_no ON public.inventory_movements;
CREATE TRIGGER trg_set_inv_movement_no BEFORE INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.set_inv_movement_no();

-- ============ Extend inventory_items ============
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS reserved_qty NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_qty NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS module TEXT,
  ADD COLUMN IF NOT EXISTS item_code TEXT,
  ADD COLUMN IF NOT EXISTS last_movement_date TIMESTAMPTZ;

-- ============ Updated apply trigger to support all movement types ============
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old_qty numeric; v_old_cost numeric; v_new_cost numeric;
BEGIN
  IF NEW.approval_status <> 'posted' THEN RETURN NEW; END IF;

  -- Increment: receipts and stock_in variants
  IF NEW.movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return') THEN
    SELECT stock, unit_cost INTO v_old_qty, v_old_cost
      FROM public.inventory_items WHERE id = NEW.item_id FOR UPDATE;
    -- Weighted average cost recalc when receiving with a unit_cost > 0
    IF NEW.unit_cost IS NOT NULL AND NEW.unit_cost > 0 AND NEW.quantity > 0 THEN
      v_new_cost := ((COALESCE(v_old_qty,0) * COALESCE(v_old_cost,0)) + (NEW.quantity * NEW.unit_cost))
                    / NULLIF(COALESCE(v_old_qty,0) + NEW.quantity, 0);
      UPDATE public.inventory_items
        SET stock = stock + NEW.quantity,
            unit_cost = COALESCE(v_new_cost, unit_cost),
            last_movement_date = now()
        WHERE id = NEW.item_id;
      -- Save cost history if cost actually changed
      IF v_old_cost IS DISTINCT FROM v_new_cost THEN
        INSERT INTO public.product_cost_history(module, target_table, target_id, old_cost, new_cost, reason, source, approved_by)
        VALUES (COALESCE(NEW.module,'shared'),'inventory_items', NEW.item_id::text,
                v_old_cost, v_new_cost, 'متوسط مرجح عند ' || NEW.movement_type, 'inv_post', NEW.performed_by);
      END IF;
    ELSE
      UPDATE public.inventory_items SET stock = stock + NEW.quantity, last_movement_date = now()
        WHERE id = NEW.item_id;
    END IF;

  -- Decrement: outflow variants
  ELSIF NEW.movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss') THEN
    SELECT (stock - reserved_qty - blocked_qty) INTO v_old_qty
      FROM public.inventory_items WHERE id = NEW.item_id FOR UPDATE;
    IF v_old_qty < NEW.quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_old_qty, NEW.quantity;
    END IF;
    UPDATE public.inventory_items SET stock = stock - NEW.quantity, last_movement_date = now()
      WHERE id = NEW.item_id;

  -- Transfer outbound (paired 'in' to destination is inserted separately)
  ELSIF NEW.movement_type = 'transfer' THEN
    SELECT (stock - reserved_qty - blocked_qty) INTO v_old_qty
      FROM public.inventory_items WHERE id = NEW.item_id FOR UPDATE;
    IF v_old_qty < NEW.quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_old_qty, NEW.quantity;
    END IF;
    UPDATE public.inventory_items SET stock = stock - NEW.quantity, last_movement_date = now()
      WHERE id = NEW.item_id;

  -- Absolute set
  ELSIF NEW.movement_type IN ('adjustment','reconciliation') THEN
    UPDATE public.inventory_items SET stock = NEW.quantity, last_movement_date = now()
      WHERE id = NEW.item_id;
  END IF;

  RETURN NEW;
END $$;

-- ============ Balances view ============
CREATE OR REPLACE VIEW public.v_inventory_balances AS
SELECT
  i.id, i.item_code, i.name, i.category, i.unit, i.module,
  i.warehouse_id, w.name AS warehouse_name, w.type AS warehouse_type,
  i.stock AS current_stock,
  i.reserved_qty AS reserved_stock,
  i.blocked_qty AS blocked_stock,
  GREATEST(i.stock - i.reserved_qty - i.blocked_qty, 0) AS available_stock,
  i.unit_cost,
  (i.stock * i.unit_cost) AS total_value,
  i.low_stock_threshold,
  (i.stock <= i.low_stock_threshold) AS is_low_stock,
  (i.unit_cost = 0 AND i.stock > 0) AS blocked_from_costing,
  i.last_movement_date,
  i.is_active
FROM public.inventory_items i
JOIN public.warehouses w ON w.id = i.warehouse_id;

GRANT SELECT ON public.v_inventory_balances TO authenticated;

-- ============ Role helpers ============
CREATE OR REPLACE FUNCTION public.can_post_inventory(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_any_role(_uid, ARRAY[
    'general_manager','executive_manager','warehouse_supervisor',
    'meat_factory_manager','feed_factory_manager','production_manager'
  ]::app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.can_approve_inventory_override(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_any_role(_uid, ARRAY[
    'general_manager','executive_manager','warehouse_supervisor'
  ]::app_role[]);
$$;

REVOKE EXECUTE ON FUNCTION public.can_post_inventory(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_approve_inventory_override(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_post_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_approve_inventory_override(uuid) TO authenticated;

-- ============ RPC: can_consume check ============
CREATE OR REPLACE FUNCTION public.inv_can_consume(p_item_id uuid, p_qty numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_avail numeric; v_cost numeric; v_stock numeric;
BEGIN
  SELECT GREATEST(stock - reserved_qty - blocked_qty, 0), unit_cost, stock
    INTO v_avail, v_cost, v_stock
    FROM public.inventory_items WHERE id = p_item_id;
  IF v_avail IS NULL THEN RAISE EXCEPTION 'ITEM_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'ok', (v_avail >= p_qty) AND (v_cost > 0 OR v_stock = 0),
    'available', v_avail,
    'requested', p_qty,
    'unit_cost', v_cost,
    'reason', CASE
      WHEN v_avail < p_qty THEN 'INSUFFICIENT_STOCK'
      WHEN v_cost = 0 AND v_stock > 0 THEN 'BLOCKED_ZERO_COST'
      ELSE NULL END
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.inv_can_consume(uuid,numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.inv_can_consume(uuid,numeric) TO authenticated;

-- ============ RPC: post a movement (single API) ============
CREATE OR REPLACE FUNCTION public.inv_post_movement(
  p_item_id uuid,
  p_warehouse_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_unit_cost numeric DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id text DEFAULT NULL,
  p_module text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_override_negative boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_uid uuid := auth.uid(); v_cost numeric; v_stock numeric;
BEGIN
  IF NOT public.can_post_inventory(v_uid) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;
  IF p_movement_type IN ('production_consumption','packaging_consumption') THEN
    SELECT unit_cost, stock INTO v_cost, v_stock FROM public.inventory_items WHERE id=p_item_id;
    IF v_cost = 0 AND v_stock > 0 THEN
      RAISE EXCEPTION 'BLOCKED_ZERO_COST';
    END IF;
  END IF;
  -- Negative stock guard for outflow types unless override (+approval)
  IF p_movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss','transfer') THEN
    IF NOT p_override_negative THEN
      DECLARE v_avail numeric;
      BEGIN
        SELECT GREATEST(stock - reserved_qty - blocked_qty,0) INTO v_avail
          FROM public.inventory_items WHERE id=p_item_id;
        IF v_avail < p_quantity THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_avail, p_quantity; END IF;
      END;
    ELSE
      IF NOT public.can_approve_inventory_override(v_uid) THEN
        RAISE EXCEPTION 'OVERRIDE_NOT_AUTHORIZED';
      END IF;
      IF p_reason IS NULL OR length(trim(p_reason))=0 THEN
        RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.inventory_movements(
    item_id, warehouse_id, movement_type, quantity, unit_cost,
    reference, reference_type, reference_id, module, reason,
    approval_status, approved_by, approved_at, performed_by
  ) VALUES (
    p_item_id, p_warehouse_id, p_movement_type, p_quantity, COALESCE(p_unit_cost,0),
    COALESCE(p_reference_type || ':' || p_reference_id, p_reason),
    p_reference_type, p_reference_id, p_module, p_reason,
    'posted', v_uid, now(), v_uid
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.inv_post_movement(uuid,uuid,text,numeric,numeric,text,text,text,text,boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.inv_post_movement(uuid,uuid,text,numeric,numeric,text,text,text,text,boolean) TO authenticated;

-- ============ RPC: transfer between warehouses (atomic) ============
CREATE OR REPLACE FUNCTION public.inv_transfer(
  p_source_item_id uuid,
  p_destination_warehouse_id uuid,
  p_quantity numeric,
  p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_src public.inventory_items%ROWTYPE;
  v_dest_item_id uuid;
  v_uid uuid := auth.uid();
  v_avail numeric;
BEGIN
  IF NOT public.can_post_inventory(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
  SELECT * INTO v_src FROM public.inventory_items WHERE id=p_source_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_NOT_FOUND'; END IF;
  IF v_src.warehouse_id = p_destination_warehouse_id THEN RAISE EXCEPTION 'SAME_WAREHOUSE'; END IF;
  v_avail := GREATEST(v_src.stock - v_src.reserved_qty - v_src.blocked_qty, 0);
  IF v_avail < p_quantity THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح %, المطلوب %', v_avail, p_quantity; END IF;

  -- Find or create destination item (same name + category + unit)
  SELECT id INTO v_dest_item_id FROM public.inventory_items
    WHERE warehouse_id=p_destination_warehouse_id AND name=v_src.name LIMIT 1;
  IF v_dest_item_id IS NULL THEN
    INSERT INTO public.inventory_items(warehouse_id, name, category, unit, stock, unit_cost, low_stock_threshold, module, item_code)
    VALUES (p_destination_warehouse_id, v_src.name, v_src.category, v_src.unit, 0, v_src.unit_cost, v_src.low_stock_threshold, v_src.module, v_src.item_code)
    RETURNING id INTO v_dest_item_id;
  END IF;

  -- Out from source
  INSERT INTO public.inventory_movements(item_id, warehouse_id, movement_type, quantity, source_warehouse_id, destination_warehouse_id, unit_cost, reason, approval_status, approved_by, approved_at, performed_by, module, reference_type)
  VALUES (p_source_item_id, v_src.warehouse_id, 'transfer', p_quantity, v_src.warehouse_id, p_destination_warehouse_id, v_src.unit_cost, p_reason, 'posted', v_uid, now(), v_uid, v_src.module, 'transfer_out');

  -- In to destination
  INSERT INTO public.inventory_movements(item_id, warehouse_id, movement_type, quantity, source_warehouse_id, destination_warehouse_id, unit_cost, reason, approval_status, approved_by, approved_at, performed_by, module, reference_type)
  VALUES (v_dest_item_id, p_destination_warehouse_id, 'in', p_quantity, v_src.warehouse_id, p_destination_warehouse_id, v_src.unit_cost, p_reason, 'posted', v_uid, now(), v_uid, v_src.module, 'transfer_in');

  RETURN jsonb_build_object('success', true, 'destination_item_id', v_dest_item_id);
END $$;

REVOKE EXECUTE ON FUNCTION public.inv_transfer(uuid,uuid,numeric,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.inv_transfer(uuid,uuid,numeric,text) TO authenticated;