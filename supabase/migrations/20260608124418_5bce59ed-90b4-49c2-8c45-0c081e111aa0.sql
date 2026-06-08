
CREATE TABLE IF NOT EXISTS public.feed_opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_type TEXT NOT NULL CHECK (warehouse_type IN ('feed_factory','brooding','slaughterhouse')),
  feed_name TEXT NOT NULL,
  feed_product_id UUID,
  quantity_kg NUMERIC(14,3) NOT NULL CHECK (quantity_kg >= 0),
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  total_value NUMERIC(14,2) GENERATED ALWAYS AS (quantity_kg * unit_cost) STORED,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  is_override BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  applied_movement_id UUID,
  created_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fob_warehouse ON public.feed_opening_balances(warehouse_type, feed_name);

GRANT SELECT, INSERT, UPDATE ON public.feed_opening_balances TO authenticated;
GRANT ALL ON public.feed_opening_balances TO service_role;
ALTER TABLE public.feed_opening_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fob_select" ON public.feed_opening_balances FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'feed_factory_manager') OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'financial_manager')
  OR has_role(auth.uid(),'brooding_manager') OR has_role(auth.uid(),'slaughterhouse_manager') OR has_role(auth.uid(),'warehouse_supervisor')
);
CREATE POLICY "fob_insert" ON public.feed_opening_balances FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'feed_factory_manager') OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'financial_manager')
);
CREATE POLICY "fob_update" ON public.feed_opening_balances FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'feed_factory_manager') OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'financial_manager')
);

-- Duplicate prevention trigger
CREATE OR REPLACE FUNCTION public.fob_check_duplicate()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_exists INT;
BEGIN
  SELECT COUNT(*) INTO v_exists
  FROM feed_opening_balances
  WHERE warehouse_type = NEW.warehouse_type
    AND lower(feed_name) = lower(NEW.feed_name)
    AND status = 'approved'
    AND id <> NEW.id;

  IF v_exists > 0 AND NOT NEW.is_override THEN
    RAISE EXCEPTION 'يوجد رصيد افتتاحي معتمد سابقاً لنفس الصنف بهذا المخزن. مطلوب موافقة مدير عام/تنفيذي مع سبب واضح (is_override=true).';
  END IF;
  IF NEW.is_override AND (NEW.override_reason IS NULL OR length(trim(NEW.override_reason)) < 5) THEN
    RAISE EXCEPTION 'تجاوز التكرار يتطلب سبب واضح (override_reason).';
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_fob_check_duplicate ON public.feed_opening_balances;
CREATE TRIGGER trg_fob_check_duplicate BEFORE INSERT OR UPDATE ON public.feed_opening_balances
FOR EACH ROW EXECUTE FUNCTION public.fob_check_duplicate();

-- Apply movement on approval
CREATE OR REPLACE FUNCTION public.fob_apply_on_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_mov_id UUID;
  v_inv_id UUID;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' AND NEW.applied_movement_id IS NULL THEN
    IF NEW.warehouse_type = 'feed_factory' THEN
      -- adjust feed_products.current_stock directly + audit
      UPDATE feed_products
        SET current_stock = current_stock + NEW.quantity_kg,
            latest_unit_cost = CASE WHEN NEW.unit_cost > 0 THEN NEW.unit_cost ELSE latest_unit_cost END
      WHERE id = NEW.feed_product_id;

      INSERT INTO feed_audit_log(table_name, row_id, action, new_value, notes)
      VALUES ('feed_products', NEW.feed_product_id, 'opening_balance',
        jsonb_build_object('qty', NEW.quantity_kg, 'unit_cost', NEW.unit_cost),
        'رصيد افتتاحي بعد انتهاء اختبار النظام — ' || NEW.reason);

    ELSIF NEW.warehouse_type = 'brooding' THEN
      INSERT INTO brooding_feed_inventory(feed_name, current_kg, last_unit_cost)
      VALUES (NEW.feed_name, 0, NEW.unit_cost)
      ON CONFLICT (feed_name) DO NOTHING;
      SELECT id INTO v_inv_id FROM brooding_feed_inventory WHERE feed_name = NEW.feed_name;

      INSERT INTO brooding_feed_stock_movements(
        feed_id, movement_type, quantity_kg, unit_cost, total_cost,
        source_type, source_id, notes
      ) VALUES (
        v_inv_id, 'opening', NEW.quantity_kg, NEW.unit_cost, NEW.quantity_kg*NEW.unit_cost,
        'opening_balance', NEW.id,
        'رصيد افتتاحي بعد انتهاء اختبار النظام — ' || NEW.reason
      ) RETURNING id INTO v_mov_id;

    ELSIF NEW.warehouse_type = 'slaughterhouse' THEN
      INSERT INTO slaughterhouse_feed_inventory(feed_product_id, feed_name, current_kg, last_unit_cost)
      VALUES (NEW.feed_product_id, NEW.feed_name, 0, NEW.unit_cost)
      ON CONFLICT (feed_product_id) DO NOTHING;
      SELECT id INTO v_inv_id FROM slaughterhouse_feed_inventory WHERE feed_product_id = NEW.feed_product_id;

      INSERT INTO slaughterhouse_feed_movements(
        feed_id, movement_type, quantity_kg, unit_cost, total_cost,
        source_type, source_id, notes
      ) VALUES (
        v_inv_id, 'opening', NEW.quantity_kg, NEW.unit_cost, NEW.quantity_kg*NEW.unit_cost,
        'opening_balance', NEW.id,
        'رصيد افتتاحي بعد انتهاء اختبار النظام — ' || NEW.reason
      ) RETURNING id INTO v_mov_id;
    END IF;

    NEW.applied_movement_id := v_mov_id;
    NEW.approved_at := COALESCE(NEW.approved_at, now());

    INSERT INTO feed_audit_log(table_name, row_id, action, new_value, performed_by, notes)
    VALUES ('feed_opening_balances', NEW.id, 'approve',
      jsonb_build_object('warehouse', NEW.warehouse_type, 'feed', NEW.feed_name, 'qty', NEW.quantity_kg, 'value', NEW.quantity_kg*NEW.unit_cost),
      NEW.approved_by,
      'اعتماد رصيد افتتاحي بعد انتهاء اختبار النظام');
  END IF;

  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_fob_apply ON public.feed_opening_balances;
CREATE TRIGGER trg_fob_apply BEFORE UPDATE OF status ON public.feed_opening_balances
FOR EACH ROW EXECUTE FUNCTION public.fob_apply_on_approval();

-- Audit insert
CREATE OR REPLACE FUNCTION public.fob_audit_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO feed_audit_log(table_name, row_id, action, new_value, performed_by, notes)
  VALUES ('feed_opening_balances', NEW.id, 'create',
    jsonb_build_object('warehouse', NEW.warehouse_type, 'feed', NEW.feed_name, 'qty', NEW.quantity_kg, 'override', NEW.is_override),
    NEW.created_by, NEW.reason);
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_fob_audit_insert ON public.feed_opening_balances;
CREATE TRIGGER trg_fob_audit_insert AFTER INSERT ON public.feed_opening_balances
FOR EACH ROW EXECUTE FUNCTION public.fob_audit_insert();

-- updated_at
CREATE OR REPLACE FUNCTION public.fob_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;
DROP TRIGGER IF EXISTS trg_fob_updated_at ON public.feed_opening_balances;
CREATE TRIGGER trg_fob_updated_at BEFORE UPDATE ON public.feed_opening_balances
FOR EACH ROW EXECUTE FUNCTION public.fob_set_updated_at();
