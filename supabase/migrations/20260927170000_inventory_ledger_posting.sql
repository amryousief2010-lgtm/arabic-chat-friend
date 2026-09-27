-- Single inventory ledger.
-- inventory_movements is the source of truth.
-- inventory_items.stock (the balance the owner calls current_stock) changes
-- only inside post_inventory_movement, under a row lock, with stock_before/stock_after.
-- The session flag app.inventory_stock_write is set only there (and by the
-- compatibility bridge that still inserts historical movement shapes).
-- Clients cannot INSERT/UPDATE/DELETE inventory_movements.
-- Posted rows are immutable. A correction is a new reversal movement.
-- Legacy rows with NULL source keys stay out of the idempotency index.
-- The invariant baseline is the first approved stocktake on/after
-- 2026-09-30 00:00 Africa/Cairo, per warehouse. This file does not backfill locks.

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS source_line_id text,
  ADD COLUMN IF NOT EXISTS reverses_movement_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_movements_source_type_check'
  ) THEN
    ALTER TABLE public.inventory_movements
      ADD CONSTRAINT inventory_movements_source_type_check
      CHECK (
        source_type IS NULL OR source_type = ANY (ARRAY[
          'order_delivery','order_return','transfer_out','transfer_in','stocktake',
          'opening_balance','purchase','waste','production','packaging_consumption',
          'manual_in','manual_out','manual_adjustment','outlet_sale','reversal'
        ])
      );
  END IF;
END $$;

-- Same document line cannot post twice. Legacy rows (NULL keys) are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_source_line_uidx
  ON public.inventory_movements (source_type, source_id, source_line_id)
  WHERE source_type IS NOT NULL
    AND source_id IS NOT NULL
    AND source_line_id IS NOT NULL
    AND COALESCE(approval_status, 'posted') = 'posted';

-- Per-line order deduction replaces the per-product unique index.
-- Two lines of the same product in one order must both post.
DROP INDEX IF EXISTS public.inventory_movements_order_item_dispatch_uidx;

ALTER TABLE public.order_deduction_lines
  ADD COLUMN IF NOT EXISTS order_item_id uuid;

ALTER TABLE public.order_deduction_lines
  DROP CONSTRAINT IF EXISTS order_deduction_lines_order_id_product_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS order_deduction_lines_order_product_uidx
  ON public.order_deduction_lines (order_id, product_id)
  WHERE order_item_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS order_deduction_lines_order_line_uidx
  ON public.order_deduction_lines (order_id, order_item_id)
  WHERE order_item_id IS NOT NULL;

-- One card per (warehouse, product) already exists and is VALID on live:
--   inventory_items_wh_product_unique (20260716123653), partial WHERE product_id IS NOT NULL.
-- Do not add a second index and do not merge cards here. If the index is missing
-- and duplicates exist, skip it so apply does not fail and balances stay put.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'inventory_items_wh_product_unique'
  ) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_items
     WHERE product_id IS NOT NULL
     GROUP BY warehouse_id, product_id
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'inventory_items_wh_product_unique skipped: duplicate cards exist';
    RETURN;
  END IF;
  CREATE UNIQUE INDEX inventory_items_wh_product_unique
    ON public.inventory_items (warehouse_id, product_id)
   WHERE product_id IS NOT NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Who may post, by warehouse id (not by warehouse name).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.warehouse_role_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  capability text NOT NULL CHECK (capability = ANY (ARRAY[
    'receive','send','post_manual','post_purchase','post_waste',
    'post_production','post_packaging','post_outlet_sale'
  ])),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, role, capability)
);

ALTER TABLE public.warehouse_role_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_role_grants_read ON public.warehouse_role_grants;
CREATE POLICY warehouse_role_grants_read ON public.warehouse_role_grants
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS warehouse_role_grants_write ON public.warehouse_role_grants;
CREATE POLICY warehouse_role_grants_write ON public.warehouse_role_grants
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'general_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::public.app_role)
  );

DROP POLICY IF EXISTS warehouse_role_grants_service ON public.warehouse_role_grants;
CREATE POLICY warehouse_role_grants_service ON public.warehouse_role_grants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.warehouse_role_grants TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.warehouse_role_grants TO authenticated, service_role;

-- Seed by id. Name matching runs once at apply time so later renames do not move rights.
INSERT INTO public.warehouse_role_grants (warehouse_id, role, capability)
SELECT w.id, g.role, g.capability
FROM public.warehouses w
JOIN (
  VALUES
    ('5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid, 'warehouse_supervisor'::public.app_role, 'receive'),
    ('5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid, 'warehouse_supervisor'::public.app_role, 'send'),
    ('5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid, 'warehouse_supervisor'::public.app_role, 'post_manual'),
    ('5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid, 'warehouse_supervisor'::public.app_role, 'post_purchase'),
    ('5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid, 'warehouse_supervisor'::public.app_role, 'post_waste'),
    ('5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid, 'warehouse_supervisor'::public.app_role, 'post_packaging'),
    ('5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid, 'warehouse_supervisor'::public.app_role, 'post_outlet_sale'),
    ('a970d469-37df-40e1-b99f-a49195a3778e'::uuid, 'agouza_warehouse_keeper'::public.app_role, 'receive'),
    ('a970d469-37df-40e1-b99f-a49195a3778e'::uuid, 'agouza_warehouse_keeper'::public.app_role, 'send'),
    ('a970d469-37df-40e1-b99f-a49195a3778e'::uuid, 'agouza_warehouse_keeper'::public.app_role, 'post_manual')
) AS g(warehouse_id, role, capability) ON g.warehouse_id = w.id
ON CONFLICT (warehouse_id, role, capability) DO NOTHING;

INSERT INTO public.warehouse_role_grants (warehouse_id, role, capability)
SELECT w.id, 'warehouse_supervisor'::public.app_role, c.capability
FROM public.warehouses w
CROSS JOIN (
  VALUES ('receive'), ('send'), ('post_manual'), ('post_purchase'),
         ('post_waste'), ('post_packaging'), ('post_outlet_sale')
) AS c(capability)
WHERE w.name ILIKE '%كارفور%'
   OR w.name ILIKE '%هيلثي%'
   OR w.name ILIKE '%تغليف%'
ON CONFLICT (warehouse_id, role, capability) DO NOTHING;

INSERT INTO public.warehouse_role_grants (warehouse_id, role, capability)
SELECT w.id, 'meat_factory_manager'::public.app_role, c.capability
FROM public.warehouses w
CROSS JOIN (
  VALUES ('receive'), ('send'), ('post_production'), ('post_waste'), ('post_packaging')
) AS c(capability)
WHERE w.name ILIKE '%مصنع اللحوم%'
ON CONFLICT (warehouse_id, role, capability) DO NOTHING;

INSERT INTO public.warehouse_role_grants (warehouse_id, role, capability)
SELECT w.id, 'feed_factory_manager'::public.app_role, 'post_production'
FROM public.warehouses w
WHERE w.name ILIKE '%علف%'
ON CONFLICT (warehouse_id, role, capability) DO NOTHING;

CREATE OR REPLACE FUNCTION public.inventory_has_warehouse_capability(
  p_uid uuid, p_warehouse_id uuid, p_capability text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_uid IS NOT NULL AND p_warehouse_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.warehouse_role_grants g
     WHERE g.warehouse_id = p_warehouse_id
       AND g.capability = p_capability
       AND public.has_role(p_uid, g.role)
  );
$$;

REVOKE ALL ON FUNCTION public.inventory_has_warehouse_capability(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_has_warehouse_capability(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inventory_can_post(
  p_uid uuid, p_source_type text, p_warehouse_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_uid IS NULL THEN
    RETURN false;
  END IF;
  IF public.has_role(p_uid, 'general_manager'::public.app_role)
     OR public.has_role(p_uid, 'executive_manager'::public.app_role) THEN
    RETURN true;
  END IF;

  CASE p_source_type
    WHEN 'order_delivery', 'order_return', 'stocktake' THEN
      RETURN false;
    WHEN 'opening_balance', 'manual_in', 'manual_out', 'manual_adjustment', 'reversal' THEN
      RETURN public.has_role(p_uid, 'warehouse_supervisor'::public.app_role)
          OR public.inventory_has_warehouse_capability(p_uid, p_warehouse_id, 'post_manual');
    WHEN 'purchase' THEN
      RETURN public.has_role(p_uid, 'procurement_manager'::public.app_role)
          OR public.has_role(p_uid, 'warehouse_supervisor'::public.app_role)
          OR public.inventory_has_warehouse_capability(p_uid, p_warehouse_id, 'post_purchase');
    WHEN 'waste' THEN
      RETURN public.has_role(p_uid, 'warehouse_supervisor'::public.app_role)
          OR public.has_role(p_uid, 'meat_factory_manager'::public.app_role)
          OR public.inventory_has_warehouse_capability(p_uid, p_warehouse_id, 'post_waste');
    WHEN 'production' THEN
      RETURN public.has_role(p_uid, 'meat_factory_manager'::public.app_role)
          OR public.has_role(p_uid, 'feed_factory_manager'::public.app_role)
          OR public.has_role(p_uid, 'production_manager'::public.app_role)
          OR public.inventory_has_warehouse_capability(p_uid, p_warehouse_id, 'post_production');
    WHEN 'packaging_consumption' THEN
      RETURN public.has_role(p_uid, 'warehouse_supervisor'::public.app_role)
          OR public.has_role(p_uid, 'meat_factory_manager'::public.app_role)
          OR public.inventory_has_warehouse_capability(p_uid, p_warehouse_id, 'post_packaging');
    WHEN 'outlet_sale' THEN
      RETURN public.has_role(p_uid, 'accountant'::public.app_role)
          OR public.has_role(p_uid, 'financial_manager'::public.app_role)
          OR public.has_role(p_uid, 'cost_accountant'::public.app_role)
          OR public.has_role(p_uid, 'warehouse_supervisor'::public.app_role)
          OR public.inventory_has_warehouse_capability(p_uid, p_warehouse_id, 'post_outlet_sale');
    WHEN 'transfer_in' THEN
      RETURN public.inventory_has_warehouse_capability(p_uid, p_warehouse_id, 'receive');
    WHEN 'transfer_out' THEN
      RETURN public.has_role(p_uid, 'warehouse_supervisor'::public.app_role)
          OR public.has_role(p_uid, 'meat_factory_manager'::public.app_role)
          OR public.has_role(p_uid, 'production_manager'::public.app_role)
          OR public.inventory_has_warehouse_capability(p_uid, p_warehouse_id, 'send');
    ELSE
      RETURN false;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_can_post(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_can_post(uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_receive_warehouse_transfer(_uid uuid, _destination_warehouse_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.has_role(_uid, 'general_manager'::public.app_role)
     OR public.has_role(_uid, 'executive_manager'::public.app_role) THEN
    RETURN true;
  END IF;
  RETURN public.inventory_has_warehouse_capability(_uid, _destination_warehouse_id, 'receive');
END;
$$;

-- ---------------------------------------------------------------------------
-- apply_inventory_movement skips when the posting function already wrote stock
-- and filled the snapshots. Otherwise a legacy insert (no snapshots) still
-- applies once. Snapshot follow-up updates are flagged so immutability allows them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_old_cost numeric;
  v_new_cost numeric;
  v_reserved numeric;
  v_blocked numeric;
  v_allow_neg boolean := false;
  v_mode text;
  v_avail numeric;
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'posted' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(current_setting('app.inventory_ledger_posted', true), '') = 'on'
     AND NEW.stock_before IS NOT NULL
     AND NEW.stock_after IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.inventory_stock_write', 'on', true);

  BEGIN
    v_allow_neg := COALESCE(current_setting('app.allow_negative_stock', true), 'off') = 'on';
  EXCEPTION WHEN OTHERS THEN
    v_allow_neg := false;
  END;

  SELECT stock, unit_cost, COALESCE(reserved_qty, 0), COALESCE(blocked_qty, 0)
    INTO v_before, v_old_cost, v_reserved, v_blocked
  FROM public.inventory_items
  WHERE id = NEW.item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود';
  END IF;

  v_mode := NULLIF(btrim(COALESCE(NEW.effect_mode, '')), '');

  IF NEW.movement_type IN ('adjustment', 'reconciliation', 'adjust') AND v_mode = 'delta' THEN
    v_after := COALESCE(v_before, 0) + COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after, last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSIF NEW.movement_type IN ('adjustment', 'reconciliation', 'adjust') THEN
    v_after := COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after, last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSIF NEW.movement_type = 'opening_balance' AND v_mode = 'set' THEN
    v_after := COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after,
           unit_cost = CASE
             WHEN NEW.unit_cost IS NOT NULL AND NEW.unit_cost > 0 THEN NEW.unit_cost
             ELSE unit_cost
           END,
           last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSIF NEW.movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return','opening_balance','sales_return') THEN
    v_after := COALESCE(v_before, 0) + COALESCE(NEW.quantity, 0);
    IF NEW.unit_cost IS NOT NULL AND NEW.unit_cost > 0 AND COALESCE(NEW.quantity, 0) > 0 THEN
      v_new_cost := ((COALESCE(v_before, 0) * COALESCE(v_old_cost, 0)) + (NEW.quantity * NEW.unit_cost))
                    / NULLIF(COALESCE(v_before, 0) + NEW.quantity, 0);
      UPDATE public.inventory_items
         SET stock = v_after,
             unit_cost = COALESCE(v_new_cost, unit_cost),
             last_movement_date = now()
       WHERE id = NEW.item_id;
      IF v_old_cost IS DISTINCT FROM v_new_cost THEN
        INSERT INTO public.product_cost_history(module, target_table, target_id, old_cost, new_cost, reason, source, approved_by)
        VALUES (COALESCE(NEW.module, 'shared'), 'inventory_items', NEW.item_id::text,
                v_old_cost, v_new_cost, 'متوسط مرجح عند ' || NEW.movement_type, 'inv_post', NEW.performed_by);
      END IF;
    ELSE
      UPDATE public.inventory_items
         SET stock = v_after, last_movement_date = now()
       WHERE id = NEW.item_id;
    END IF;

  ELSIF NEW.movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss','transfer','sales_dispatch') THEN
    v_avail := COALESCE(v_before, 0) - v_reserved - v_blocked;
    IF v_avail < COALESCE(NEW.quantity, 0) AND NOT v_allow_neg THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_avail, NEW.quantity;
    END IF;
    v_after := COALESCE(v_before, 0) - COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after, last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSE
    v_after := v_before;
  END IF;

  PERFORM set_config('app.inventory_movement_snapshot', 'on', true);
  UPDATE public.inventory_movements
     SET stock_before = v_before,
         stock_after = v_after,
         effect_mode = COALESCE(
           NEW.effect_mode,
           CASE
             WHEN NEW.movement_type IN ('adjustment', 'reconciliation', 'adjust') THEN 'set'
             ELSE 'delta'
           END
         )
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_inventory_movement_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old numeric;
  v_new numeric;
  v_before numeric;
  v_mode text;
BEGIN
  IF COALESCE(current_setting('app.inventory_ledger_relink', true), '') = 'on'
     OR COALESCE(current_setting('app.inventory_movement_snapshot', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.approval_status IS DISTINCT FROM 'posted' OR OLD.approval_status IS DISTINCT FROM 'posted' THEN
    RETURN NEW;
  END IF;

  v_old := public.inventory_movement_signed_effect(
    OLD.movement_type, OLD.quantity, OLD.effect_mode, OLD.stock_before, OLD.stock_after
  );
  v_mode := COALESCE(NEW.effect_mode, OLD.effect_mode);

  IF NEW.movement_type IN ('adjustment', 'reconciliation', 'adjust')
     AND COALESCE(v_mode, 'set') <> 'delta' THEN
    IF OLD.stock_before IS NULL THEN
      RAISE EXCEPTION 'لا يمكن تعديل تسوية مطلقة بدون لقطة الرصيد قبل الحركة';
    END IF;
    v_new := COALESCE(NEW.quantity, 0) - OLD.stock_before;
    PERFORM set_config('app.inventory_stock_write', 'on', true);
    UPDATE public.inventory_items
       SET stock = COALESCE(stock, 0) - COALESCE(v_old, 0) + v_new,
           last_movement_date = now()
     WHERE id = NEW.item_id;
    PERFORM set_config('app.inventory_movement_snapshot', 'on', true);
    UPDATE public.inventory_movements
       SET stock_before = OLD.stock_before,
           stock_after = OLD.stock_before + v_new,
           effect_mode = 'set'
     WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'لا يمكن تعديل هذه الحركة بدون لقطة رصيد قبل وبعد';
  END IF;

  v_new := public.inventory_movement_signed_effect(
    NEW.movement_type, NEW.quantity, v_mode, NULL, NULL
  );
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'لا يمكن تعديل هذه الحركة بدون لقطة رصيد قبل وبعد';
  END IF;

  PERFORM set_config('app.inventory_stock_write', 'on', true);

  IF NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    UPDATE public.inventory_items
       SET stock = COALESCE(stock, 0) - v_old, last_movement_date = now()
     WHERE id = OLD.item_id;
    SELECT stock INTO v_before FROM public.inventory_items WHERE id = NEW.item_id FOR UPDATE;
    UPDATE public.inventory_items
       SET stock = COALESCE(v_before, 0) + v_new, last_movement_date = now()
     WHERE id = NEW.item_id;
    PERFORM set_config('app.inventory_movement_snapshot', 'on', true);
    UPDATE public.inventory_movements
       SET stock_before = v_before, stock_after = COALESCE(v_before, 0) + v_new
     WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  UPDATE public.inventory_items
     SET stock = COALESCE(stock, 0) - v_old + v_new,
         last_movement_date = now()
   WHERE id = NEW.item_id;

  PERFORM set_config('app.inventory_movement_snapshot', 'on', true);
  UPDATE public.inventory_movements
     SET stock_after = COALESCE(OLD.stock_before, NEW.stock_before) + v_new
   WHERE id = NEW.id
     AND OLD.stock_before IS NOT NULL;

  RETURN NEW;
END;
$$;

-- Reject every write that did not come from the posting function.
-- app.inventory_ledger_posted is SET LOCAL. It lasts the current transaction only.
-- PostgREST is one transaction per request, so a client cannot set the flag
-- and then insert. Do not clear the flag inside the function: a sibling trigger
-- would turn it off before this guard runs.
CREATE OR REPLACE FUNCTION public.reject_direct_inventory_movement_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(current_setting('app.inventory_ledger_posted', true), '') = 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'LEDGER_ONLY: حركات المخزون تُسجّل فقط عبر دالة الترحيل post_inventory_movement';
  ELSIF TG_OP = 'DELETE' THEN
    IF COALESCE(current_setting('app.inventory_ledger_purge', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'IMMUTABLE: الحركة المرحّلة لا تُحذف. أنشئ حركة عكسية بسبب مكتوب';
  ELSIF TG_OP = 'UPDATE' THEN
    IF COALESCE(current_setting('app.inventory_ledger_posted', true), '') = 'on'
       OR COALESCE(current_setting('app.inventory_movement_snapshot', true), '') = 'on'
       OR COALESCE(current_setting('app.inventory_ledger_relink', true), '') = 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'IMMUTABLE: الحركة المرحّلة لا تُعدّل. أنشئ حركة عكسية بسبب مكتوب';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_reject_direct_inventory_movement_write ON public.inventory_movements;
CREATE TRIGGER trg_00_reject_direct_inventory_movement_write
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.reject_direct_inventory_movement_write();

-- ---------------------------------------------------------------------------
-- The only stock writer for new documents.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_inventory_movement(
  p_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_source_type text,
  p_source_id uuid,
  p_source_line_id text,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_performed_at timestamptz DEFAULT NULL,
  p_unit_cost numeric DEFAULT NULL,
  p_party text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_effect_mode text DEFAULT NULL,
  p_allow_negative boolean DEFAULT false,
  p_warehouse_id uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_module text DEFAULT NULL,
  p_reverses_movement_id uuid DEFAULT NULL,
  p_override_reason text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id text DEFAULT NULL,
  p_destination_warehouse_id uuid DEFAULT NULL,
  p_package_count numeric DEFAULT NULL,
  p_package_weight_kg numeric DEFAULT NULL,
  p_order_item_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before numeric;
  v_after numeric;
  v_cost numeric;
  v_new_cost numeric;
  v_wh uuid;
  v_reserved numeric;
  v_blocked numeric;
  v_avail numeric;
  v_mode text;
  v_mov uuid;
  v_existing uuid;
  v_existing_before numeric;
  v_existing_after numeric;
  v_when timestamptz := COALESCE(p_performed_at, now());
  v_lock timestamptz;
  v_override text := NULLIF(btrim(COALESCE(p_override_reason, '')), '');
  v_internal boolean := COALESCE(current_setting('app.inventory_internal_post', true), '') = 'on';
  v_qty numeric := p_quantity;
BEGIN
  IF p_item_id IS NULL OR p_movement_type IS NULL OR p_source_type IS NULL
     OR p_source_id IS NULL OR p_source_line_id IS NULL OR length(btrim(p_source_line_id)) = 0 THEN
    RAISE EXCEPTION 'SOURCE_REQUIRED: كل حركة تحتاج صنفاً ونوع مستند ومفتاح سطر';
  END IF;

  IF NOT v_internal THEN
    IF NOT public.inventory_can_post(v_uid, p_source_type, COALESCE(p_warehouse_id, (
      SELECT warehouse_id FROM public.inventory_items WHERE id = p_item_id
    ))) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح بترحيل % على هذا المخزن', p_source_type;
    END IF;
  END IF;

  SELECT m.id, m.stock_before, m.stock_after
    INTO v_existing, v_existing_before, v_existing_after
  FROM public.inventory_movements m
  WHERE m.source_type = p_source_type
    AND m.source_id = p_source_id
    AND m.source_line_id = p_source_line_id
    AND COALESCE(m.approval_status, 'posted') = 'posted'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_existing,
      'status', 'already_posted',
      'stock_before', v_existing_before,
      'stock_after', v_existing_after,
      'source_type', p_source_type
    );
  END IF;

  v_mode := COALESCE(NULLIF(btrim(COALESCE(p_effect_mode, '')), ''),
    CASE
      WHEN p_movement_type IN ('adjustment', 'reconciliation', 'adjust') THEN 'delta'
      WHEN p_movement_type = 'opening_balance' THEN 'set'
      ELSE 'delta'
    END);

  BEGIN
    SELECT stock, unit_cost, warehouse_id, COALESCE(reserved_qty, 0), COALESCE(blocked_qty, 0)
      INTO v_before, v_cost, v_wh, v_reserved, v_blocked
    FROM public.inventory_items
    WHERE id = p_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'الصنف غير موجود';
    END IF;

    v_wh := COALESCE(p_warehouse_id, v_wh);

    v_lock := public.warehouse_period_locked_until(v_wh);
    IF v_lock IS NOT NULL AND v_when < v_lock THEN
      IF v_override IS NULL OR length(v_override) < 3
         OR v_uid IS NULL
         OR NOT (
           public.has_role(v_uid, 'general_manager'::public.app_role)
           OR public.has_role(v_uid, 'executive_manager'::public.app_role)
         ) THEN
        RAISE EXCEPTION
          'الفترة مقفلة لهذا المخزن حتى %. لا يمكن تسجيل حركة بتاريخ أقدم. التجاوز للمدير العام أو المدير التنفيذي مع سبب مكتوب.',
          to_char(v_lock AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI');
      END IF;
    ELSE
      v_override := NULL;
    END IF;

    IF p_movement_type IN ('adjustment', 'reconciliation', 'adjust') AND v_mode = 'delta' THEN
      v_after := COALESCE(v_before, 0) + COALESCE(v_qty, 0);
    ELSIF p_movement_type IN ('adjustment', 'reconciliation', 'adjust')
          OR (p_movement_type = 'opening_balance' AND v_mode = 'set') THEN
      v_after := COALESCE(v_qty, 0);
    ELSIF p_movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return','opening_balance','sales_return') THEN
      v_after := COALESCE(v_before, 0) + abs(COALESCE(v_qty, 0));
      v_qty := abs(COALESCE(v_qty, 0));
    ELSIF p_movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss','transfer','sales_dispatch') THEN
      v_avail := COALESCE(v_before, 0) - v_reserved - v_blocked;
      IF v_avail < abs(COALESCE(v_qty, 0)) AND NOT p_allow_negative THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_avail, abs(v_qty);
      END IF;
      v_after := COALESCE(v_before, 0) - abs(COALESCE(v_qty, 0));
      v_qty := abs(COALESCE(v_qty, 0));
    ELSE
      RAISE EXCEPTION 'UNKNOWN_MOVEMENT_TYPE: %', p_movement_type;
    END IF;

    IF v_after < 0 AND NOT p_allow_negative THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: الرصيد بعد الحركة سيكون %', v_after;
    END IF;

    v_new_cost := v_cost;
    IF p_movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return','opening_balance','sales_return')
       AND p_unit_cost IS NOT NULL AND p_unit_cost > 0 AND COALESCE(v_qty, 0) > 0
       AND NOT (p_movement_type = 'opening_balance' AND v_mode = 'set') THEN
      v_new_cost := ((COALESCE(v_before, 0) * COALESCE(v_cost, 0)) + (abs(v_qty) * p_unit_cost))
                    / NULLIF(COALESCE(v_before, 0) + abs(v_qty), 0);
    ELSIF p_unit_cost IS NOT NULL AND p_unit_cost > 0
          AND p_movement_type = 'opening_balance' AND v_mode = 'set' THEN
      v_new_cost := p_unit_cost;
    END IF;

    PERFORM set_config('app.inventory_stock_write', 'on', true);
    PERFORM set_config('app.inventory_ledger_posted', 'on', true);
    IF p_allow_negative THEN
      PERFORM set_config('app.allow_negative_stock', 'on', true);
    END IF;

    UPDATE public.inventory_items
       SET stock = v_after,
           last_movement_date = now(),
           unit_cost = COALESCE(v_new_cost, unit_cost)
     WHERE id = p_item_id;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, source_warehouse_id, destination_warehouse_id,
      movement_type, quantity, quantity_kg, unit_cost, total_cost,
      reference, reference_type, reference_id, party, notes, reason,
      performed_by, performed_at, approval_status, approved_by, approved_at,
      module, product_id, order_item_id, effect_mode,
      stock_before, stock_after, period_lock_override_reason,
      package_count, package_weight_kg,
      source_type, source_id, source_line_id, reverses_movement_id
    ) VALUES (
      p_item_id, v_wh, v_wh, p_destination_warehouse_id,
      p_movement_type, v_qty, abs(v_qty),
      COALESCE(p_unit_cost, v_cost, 0),
      abs(COALESCE(v_qty, 0)) * COALESCE(p_unit_cost, v_cost, 0),
      p_reference, COALESCE(p_reference_type, p_source_type),
      COALESCE(p_reference_id, p_source_id::text),
      p_party, p_notes, p_reason,
      v_uid, v_when, 'posted', v_uid, now(),
      COALESCE(p_module, 'ledger'), p_product_id, p_order_item_id, v_mode,
      v_before, v_after, v_override,
      p_package_count, p_package_weight_kg,
      p_source_type, p_source_id, p_source_line_id, p_reverses_movement_id
    ) RETURNING id INTO v_mov;

    RETURN jsonb_build_object(
      'id', v_mov,
      'status', 'posted',
      'stock_before', v_before,
      'stock_after', v_after,
      'movement_type', p_movement_type,
      'source_type', p_source_type
    );
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT ILIKE '%inventory_movements_source_line_uidx%' THEN
      RAISE;
    END IF;
    SELECT m.id, m.stock_before, m.stock_after
      INTO v_existing, v_existing_before, v_existing_after
    FROM public.inventory_movements m
    WHERE m.source_type = p_source_type
      AND m.source_id = p_source_id
      AND m.source_line_id = p_source_line_id
      AND COALESCE(m.approval_status, 'posted') = 'posted'
    LIMIT 1;
    RETURN jsonb_build_object(
      'id', v_existing,
      'status', 'already_posted',
      'stock_before', v_existing_before,
      'stock_after', v_existing_after,
      'source_type', p_source_type
    );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.post_inventory_movement(
  uuid, text, numeric, text, uuid, text, text, text, timestamptz, numeric,
  text, text, text, boolean, uuid, uuid, text, uuid, text, text, text, uuid, numeric, numeric, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_inventory_movement(
  uuid, text, numeric, text, uuid, text, text, text, timestamptz, numeric,
  text, text, text, boolean, uuid, uuid, text, uuid, text, text, text, uuid, numeric, numeric, uuid
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reverse_posted_inventory_movement(
  p_movement_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_m public.inventory_movements%ROWTYPE;
  v_effect numeric;
  v_existing uuid;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: سبب العكس مطلوب (٣ حروف على الأقل)';
  END IF;

  SELECT * INTO v_m FROM public.inventory_movements WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVEMENT_NOT_FOUND';
  END IF;
  IF v_m.source_type = 'reversal' THEN
    RAISE EXCEPTION 'لا يُعكس قيد العكس. اعكس الحركة الأصلية';
  END IF;

  SELECT id INTO v_existing
  FROM public.inventory_movements
  WHERE source_type = 'reversal'
    AND source_id = p_movement_id
    AND source_line_id = '1'
    AND COALESCE(approval_status, 'posted') = 'posted'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_existing, 'status', 'already_reversed');
  END IF;

  v_effect := public.inventory_movement_signed_effect(
    v_m.movement_type, v_m.quantity, v_m.effect_mode, v_m.stock_before, v_m.stock_after
  );
  IF v_effect IS NULL OR v_m.stock_before IS NULL OR v_m.stock_after IS NULL THEN
    RAISE EXCEPTION 'لا يمكن عكس حركة بدون لقطة رصيد قبل وبعد (%)', p_movement_id;
  END IF;
  IF v_effect = 0 THEN
    RETURN jsonb_build_object('id', NULL, 'status', 'zero_effect');
  END IF;

  RETURN public.post_inventory_movement(
    v_m.item_id,
    'adjustment',
    -v_effect,
    'reversal',
    p_movement_id,
    '1',
    btrim(p_reason),
    'عكس حركة ' || COALESCE(v_m.movement_no, v_m.id::text) || ' نوعها ' || v_m.movement_type,
    now(),
    v_m.unit_cost,
    v_m.party,
    v_m.reference,
    'delta',
    false,
    v_m.warehouse_id,
    v_m.product_id,
    'ledger_reversal',
    p_movement_id,
    NULL,
    'reversal',
    p_movement_id::text,
    NULL,
    NULL,
    NULL,
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_posted_inventory_movement(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_posted_inventory_movement(uuid, text) TO authenticated, service_role;

-- Document wrappers. They do not set the internal flag, so the role matrix applies.
CREATE OR REPLACE FUNCTION public.post_purchase_in_packs(
  p_item_id uuid,
  p_packs numeric,
  p_supplier text,
  p_cost_per_pack numeric,
  p_source_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_weight numeric;
  v_kg numeric;
  v_cost_kg numeric;
BEGIN
  IF p_packs IS NULL OR p_packs <= 0 THEN
    RAISE EXCEPTION 'INVALID_QTY: عدد العبوات يجب أن يكون أكبر من صفر';
  END IF;
  SELECT COALESCE(pack_weight_kg, 0.5) INTO v_weight
  FROM public.inventory_items WHERE id = p_item_id;
  IF v_weight IS NULL OR v_weight <= 0 THEN
    v_weight := 0.5;
  END IF;
  v_kg := p_packs * v_weight;
  v_cost_kg := CASE WHEN p_cost_per_pack IS NOT NULL AND p_cost_per_pack > 0
                    THEN p_cost_per_pack / v_weight ELSE NULL END;
  RETURN public.post_inventory_movement(
    p_item_id, 'purchase_receipt', v_kg, 'purchase',
    COALESCE(p_source_id, gen_random_uuid()), '1',
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'شراء مورد'),
    'عبوات=' || p_packs::text || ' × ' || v_weight::text || ' كجم',
    now(), v_cost_kg, p_supplier, p_supplier, 'delta', false,
    NULL, NULL, 'purchase', NULL, NULL, 'purchase', NULL, NULL, p_packs, v_weight, NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_waste_movement(
  p_item_id uuid, p_kg numeric, p_reason text, p_source_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: سبب الهالك مطلوب';
  END IF;
  RETURN public.post_inventory_movement(
    p_item_id, 'waste_loss', p_kg, 'waste',
    COALESCE(p_source_id, gen_random_uuid()), '1',
    btrim(p_reason), NULL, now(), NULL, NULL, NULL, 'delta', false,
    NULL, NULL, 'waste', NULL, NULL, 'waste', NULL, NULL, NULL, NULL, NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_outlet_sale(
  p_item_id uuid, p_kg numeric, p_statement_ref text, p_source_id uuid, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_statement_ref IS NULL OR length(btrim(p_statement_ref)) < 2 THEN
    RAISE EXCEPTION 'STATEMENT_REQUIRED: رقم كشف المبيعات مطلوب';
  END IF;
  RETURN public.post_inventory_movement(
    p_item_id, 'out', p_kg, 'outlet_sale',
    COALESCE(p_source_id, gen_random_uuid()), '1',
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'كشف مبيعات منفذ'),
    'كشف ' || btrim(p_statement_ref), now(), NULL, btrim(p_statement_ref), btrim(p_statement_ref),
    'delta', false, NULL, NULL, 'outlet', NULL, NULL, 'outlet_sale', NULL, NULL, NULL, NULL, NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_production_movement(
  p_item_id uuid, p_kg numeric, p_direction text, p_batch_id uuid, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_type text;
  v_line text;
BEGIN
  IF p_direction NOT IN ('input', 'output') THEN
    RAISE EXCEPTION 'INVALID_DIRECTION: input للخامات الخارجة أو output للإنتاج الداخل';
  END IF;
  v_type := CASE WHEN p_direction = 'input' THEN 'production_consumption' ELSE 'finished_goods_receipt' END;
  v_line := p_direction || ':' || p_item_id::text;
  RETURN public.post_inventory_movement(
    p_item_id, v_type, p_kg, 'production',
    COALESCE(p_batch_id, gen_random_uuid()), v_line,
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'إنتاج'),
    NULL, now(), NULL, NULL, NULL, 'delta', false,
    NULL, NULL, 'production', NULL, NULL, 'production', NULL, NULL, NULL, NULL, NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_packaging_consumption(
  p_item_id uuid, p_kg numeric, p_source_id uuid, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN public.post_inventory_movement(
    p_item_id, 'packaging_consumption', p_kg, 'packaging_consumption',
    COALESCE(p_source_id, gen_random_uuid()), '1',
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'استهلاك تغليف'),
    NULL, now(), NULL, NULL, NULL, 'delta', false,
    NULL, NULL, 'packaging', NULL, NULL, 'packaging_consumption', NULL, NULL, NULL, NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_purchase_in_packs(uuid, numeric, text, numeric, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_waste_movement(uuid, numeric, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_outlet_sale(uuid, numeric, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_production_movement(uuid, numeric, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_packaging_consumption(uuid, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_purchase_in_packs(uuid, numeric, text, numeric, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_waste_movement(uuid, numeric, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_outlet_sale(uuid, numeric, text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_production_movement(uuid, numeric, text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_packaging_consumption(uuid, numeric, uuid, text) TO authenticated, service_role;

-- Clients lose direct movement writes. SECURITY DEFINER functions still insert
-- as the owner; the trigger requires the ledger flag.
DO $priv$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated']
  LOOP
    IF r = 'PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.inventory_movements FROM %s', r);
      IF r <> 'PUBLIC' THEN
        EXECUTE format(
          'GRANT SELECT (source_type, source_id, source_line_id, reverses_movement_id) ON public.inventory_movements TO %s',
          r
        );
      END IF;
    END IF;
  END LOOP;
END
$priv$;

DROP VIEW IF EXISTS public.inventory_movements_visible;
CREATE VIEW public.inventory_movements_visible
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  id, item_id, warehouse_id, movement_type, quantity, destination_warehouse_id,
  reference, party,
  CASE WHEN public.can_view_inventory_cost(auth.uid()) THEN unit_cost ELSE NULL END AS unit_cost,
  notes, performed_by, performed_at, created_at, movement_no, module,
  source_warehouse_id, reference_type, reference_id, batch_id, reason,
  approval_status, approved_by, approved_at,
  CASE WHEN public.can_view_inventory_cost(auth.uid()) THEN total_cost ELSE NULL END AS total_cost,
  order_item_id, product_id, package_count, package_weight_kg, quantity_kg,
  stock_before, stock_after, effect_mode, period_lock_override_reason,
  source_type, source_id, source_line_id, reverses_movement_id
FROM public.inventory_movements;

GRANT SELECT ON public.inventory_movements_visible TO authenticated, anon, service_role;
