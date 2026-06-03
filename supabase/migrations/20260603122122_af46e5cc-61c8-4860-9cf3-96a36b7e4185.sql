
-- Sequences for movement numbers
CREATE SEQUENCE IF NOT EXISTS public.brooding_movement_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.feed_factory_movement_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.feed_transfer_ref_seq START 1;

-- ============================================================
-- Brooding movements table
-- ============================================================
CREATE TABLE public.brooding_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_no text NOT NULL UNIQUE,
  movement_type text NOT NULL,
  direction text NOT NULL DEFAULT 'NONE' CHECK (direction IN ('IN','OUT','NONE')),
  batch_id uuid,
  item_name text,
  quantity numeric DEFAULT 0,
  unit text,
  unit_cost numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  from_party text,
  to_party text,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed','pending')),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  linked_movement_id uuid,
  reference_no text,
  source_table text,
  source_id uuid,
  reverses_movement_id uuid,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brmov_created_at ON public.brooding_movements (created_at DESC);
CREATE INDEX idx_brmov_batch ON public.brooding_movements (batch_id);
CREATE INDEX idx_brmov_type ON public.brooding_movements (movement_type);
CREATE INDEX idx_brmov_ref ON public.brooding_movements (reference_no);
CREATE INDEX idx_brmov_source ON public.brooding_movements (source_table, source_id);

GRANT SELECT, INSERT ON public.brooding_movements TO authenticated;
GRANT ALL ON public.brooding_movements TO service_role;

ALTER TABLE public.brooding_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated reads brooding movements"
  ON public.brooding_movements FOR SELECT TO authenticated USING (true);

CREATE POLICY "GM/EM can insert manual brooding movements"
  ON public.brooding_movements FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
  );

-- ============================================================
-- Feed factory movements table
-- ============================================================
CREATE TABLE public.feed_factory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_no text NOT NULL UNIQUE,
  movement_type text NOT NULL,
  direction text NOT NULL DEFAULT 'NONE' CHECK (direction IN ('IN','OUT','NONE')),
  item_name text,
  quantity numeric DEFAULT 0,
  unit text,
  unit_cost numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  from_party text,
  to_party text,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed','pending')),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  linked_movement_id uuid,
  reference_no text,
  source_table text,
  source_id uuid,
  reverses_movement_id uuid,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ffmov_created_at ON public.feed_factory_movements (created_at DESC);
CREATE INDEX idx_ffmov_type ON public.feed_factory_movements (movement_type);
CREATE INDEX idx_ffmov_ref ON public.feed_factory_movements (reference_no);
CREATE INDEX idx_ffmov_source ON public.feed_factory_movements (source_table, source_id);

GRANT SELECT, INSERT ON public.feed_factory_movements TO authenticated;
GRANT ALL ON public.feed_factory_movements TO service_role;

ALTER TABLE public.feed_factory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated reads feed factory movements"
  ON public.feed_factory_movements FOR SELECT TO authenticated USING (true);

CREATE POLICY "GM/EM can insert manual feed factory movements"
  ON public.feed_factory_movements FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
  );

-- ============================================================
-- Prevent UPDATE/DELETE on posted movements (audit log)
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_movement_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'حذف سجل الحركات ممنوع. استخدم حركة عكسية.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- only allow status flip from posted -> reversed (or annotation of linked_movement_id)
    IF OLD.status = 'posted' AND NEW.status NOT IN ('posted','reversed') THEN
      RAISE EXCEPTION 'تعديل الحركات المعتمدة ممنوع.';
    END IF;
    IF OLD.movement_no <> NEW.movement_no
       OR OLD.movement_type <> NEW.movement_type
       OR OLD.quantity IS DISTINCT FROM NEW.quantity
       OR OLD.total_cost IS DISTINCT FROM NEW.total_cost THEN
      RAISE EXCEPTION 'تعديل بيانات الحركة المعتمدة ممنوع. أنشئ حركة عكسية.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_brmov_no_mutation
  BEFORE UPDATE OR DELETE ON public.brooding_movements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_movement_mutation();

CREATE TRIGGER trg_ffmov_no_mutation
  BEFORE UPDATE OR DELETE ON public.feed_factory_movements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_movement_mutation();

-- ============================================================
-- Helper: generate movement numbers
-- ============================================================
CREATE OR REPLACE FUNCTION public.next_brooding_movement_no()
RETURNS text LANGUAGE sql AS $$
  SELECT 'BRD-MOV-' || lpad(nextval('public.brooding_movement_seq')::text, 5, '0');
$$;

CREATE OR REPLACE FUNCTION public.next_feed_factory_movement_no()
RETURNS text LANGUAGE sql AS $$
  SELECT 'FF-MOV-' || lpad(nextval('public.feed_factory_movement_seq')::text, 5, '0');
$$;

CREATE OR REPLACE FUNCTION public.next_feed_transfer_ref()
RETURNS text LANGUAGE sql AS $$
  SELECT 'FEED-TR-' || lpad(nextval('public.feed_transfer_ref_seq')::text, 5, '0');
$$;

-- ============================================================
-- Trigger: log brooding batch additions
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_brooding_batch_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_qty numeric;
  v_cost numeric;
  v_total numeric;
BEGIN
  v_qty := COALESCE(NEW.initial_count, 0);
  v_cost := COALESCE(NEW.cost_per_chick, 0);
  v_total := COALESCE(NEW.total_cost, v_qty * v_cost);

  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, unit_cost, total_cost,
    from_party, to_party, created_by, source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'batch_add', 'IN', NEW.id,
    'كتاكيت — ' || COALESCE(NEW.batch_no, ''),
    v_qty, 'كتكوت', v_cost, v_total,
    COALESCE(NEW.source, 'خارجي'), 'التحضين والتسمين',
    auth.uid(), 'brooding_batches', NEW.id,
    NEW.notes
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_log_brooding_batch_add
  AFTER INSERT ON public.brooding_batches
  FOR EACH ROW EXECUTE FUNCTION public.log_brooding_batch_movement();

-- ============================================================
-- Trigger: log mortality
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_brooding_mortality_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch_no text;
BEGIN
  SELECT batch_no INTO v_batch_no FROM public.brooding_batches WHERE id = NEW.batch_id;
  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, created_by, source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'mortality', 'OUT', NEW.batch_id,
    'نافق — دفعة ' || COALESCE(v_batch_no,''),
    COALESCE(NEW.death_count, 0), 'كتكوت',
    auth.uid(), 'brooding_mortality', NEW.id,
    NEW.cause
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_log_brooding_mortality
  AFTER INSERT ON public.brooding_mortality
  FOR EACH ROW EXECUTE FUNCTION public.log_brooding_mortality_movement();

-- ============================================================
-- Trigger: log feed issuance on batches (OUT)
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_brooding_feed_issuance_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch_no text;
  v_feed_name text;
  v_unit_cost numeric;
BEGIN
  SELECT batch_no INTO v_batch_no FROM public.brooding_batches WHERE id = NEW.batch_id;
  SELECT name, COALESCE(cost_per_kg, 0) INTO v_feed_name, v_unit_cost
    FROM public.brooding_feed_inventory WHERE id = NEW.feed_id;

  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, unit_cost, total_cost,
    from_party, to_party, created_by, source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'feed_issue', 'OUT', NEW.batch_id,
    'علف — ' || COALESCE(v_feed_name, ''),
    COALESCE(NEW.quantity_kg, 0), 'كجم',
    v_unit_cost, COALESCE(NEW.quantity_kg,0) * v_unit_cost,
    'مخزون علف التحضين', 'دفعة ' || COALESCE(v_batch_no,''),
    auth.uid(), 'brooding_feed_issuance', NEW.id, NEW.notes
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_log_brooding_feed_issuance
  AFTER INSERT ON public.brooding_feed_issuance
  FOR EACH ROW EXECUTE FUNCTION public.log_brooding_feed_issuance_movement();

-- ============================================================
-- Trigger: log medicine issuance
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_brooding_medicine_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch_no text;
BEGIN
  SELECT batch_no INTO v_batch_no FROM public.brooding_batches WHERE id = NEW.batch_id;
  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, unit_cost, total_cost, created_by,
    source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'medicine_issue', 'OUT', NEW.batch_id,
    'دواء — ' || COALESCE(NEW.medicine_name, ''),
    COALESCE(NEW.quantity, 0), COALESCE(NEW.unit, 'وحدة'),
    COALESCE(NEW.unit_cost, 0), COALESCE(NEW.total_cost, 0),
    auth.uid(), 'brooding_medicine_issuance', NEW.id, NEW.notes
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_log_brooding_medicine
  AFTER INSERT ON public.brooding_medicine_issuance
  FOR EACH ROW EXECUTE FUNCTION public.log_brooding_medicine_movement();

-- ============================================================
-- Trigger: log expenses
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_brooding_expense_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, total_cost, created_by,
    source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'expense', 'OUT', NEW.batch_id,
    COALESCE(NEW.description, NEW.category, 'مصروف'),
    1, 'بند', COALESCE(NEW.amount, 0),
    auth.uid(), 'brooding_expenses', NEW.id, NEW.notes
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_log_brooding_expense
  AFTER INSERT ON public.brooding_expenses
  FOR EACH ROW EXECUTE FUNCTION public.log_brooding_expense_movement();

-- ============================================================
-- Trigger: log chick sales
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_brooding_chick_sale_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch_no text;
BEGIN
  SELECT batch_no INTO v_batch_no FROM public.brooding_batches WHERE id = NEW.batch_id;
  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, unit_cost, total_cost,
    from_party, to_party, created_by, source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'chicks_sale', 'OUT', NEW.batch_id,
    'بيع كتاكيت — دفعة ' || COALESCE(v_batch_no,''),
    COALESCE(NEW.count_sold, 0), 'كتكوت',
    COALESCE(NEW.price_per_chick, 0), COALESCE(NEW.total_value, 0),
    'التحضين والتسمين', COALESCE(NEW.customer_name, 'عميل'),
    auth.uid(), 'brooding_chick_sales', NEW.id, NEW.notes
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_log_brooding_chick_sale
  AFTER INSERT ON public.brooding_chick_sales
  FOR EACH ROW EXECUTE FUNCTION public.log_brooding_chick_sale_movement();

-- ============================================================
-- Trigger: log slaughter transfers
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_brooding_slaughter_transfer_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch_no text;
BEGIN
  SELECT batch_no INTO v_batch_no FROM public.brooding_batches WHERE id = NEW.batch_id;
  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, unit_cost, total_cost,
    from_party, to_party, created_by, source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'slaughter_transfer', 'OUT', NEW.batch_id,
    'تحويل للمجزر — دفعة ' || COALESCE(v_batch_no,''),
    COALESCE(NEW.count_transferred, 0), 'طائر',
    COALESCE(NEW.cost_per_bird, 0), COALESCE(NEW.total_value, 0),
    'التحضين والتسمين', 'المجزر',
    auth.uid(), 'brooding_to_slaughter_transfers', NEW.id, NEW.notes
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_log_brooding_slaughter_transfer
  AFTER INSERT ON public.brooding_to_slaughter_transfers
  FOR EACH ROW EXECUTE FUNCTION public.log_brooding_slaughter_transfer_movement();

-- ============================================================
-- Trigger: log feed stock movements (purchase => linked pair)
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_brooding_feed_stock_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_feed_name text;
  v_ref text;
  v_br_id uuid;
  v_ff_id uuid;
  v_br_no text;
  v_ff_no text;
  v_total numeric;
BEGIN
  SELECT name INTO v_feed_name FROM public.brooding_feed_inventory WHERE id = NEW.feed_id;
  v_total := COALESCE(NEW.total_cost, COALESCE(NEW.quantity_kg,0) * COALESCE(NEW.unit_cost,0));

  IF NEW.movement_type = 'purchase' THEN
    v_ref := next_feed_transfer_ref();
    v_br_no := next_brooding_movement_no();
    v_ff_no := next_feed_factory_movement_no();
    v_br_id := gen_random_uuid();
    v_ff_id := gen_random_uuid();

    -- IN side: brooding receives
    INSERT INTO public.brooding_movements (
      id, movement_no, movement_type, direction, item_name,
      quantity, unit, unit_cost, total_cost,
      from_party, to_party, created_by,
      source_table, source_id, reference_no, linked_movement_id, notes
    ) VALUES (
      v_br_id, v_br_no, 'feed_receive', 'IN',
      'استلام علف — ' || COALESCE(v_feed_name,''),
      COALESCE(NEW.quantity_kg,0), 'كجم',
      COALESCE(NEW.unit_cost,0), v_total,
      'مصنع الأعلاف', 'مخزون علف التحضين', auth.uid(),
      'brooding_feed_stock_movements', NEW.id, v_ref, v_ff_id, NEW.notes
    );

    -- OUT side: feed factory supplies
    INSERT INTO public.feed_factory_movements (
      id, movement_no, movement_type, direction, item_name,
      quantity, unit, unit_cost, total_cost,
      from_party, to_party, created_by,
      source_table, source_id, reference_no, linked_movement_id, notes
    ) VALUES (
      v_ff_id, v_ff_no, 'brooding_supply', 'OUT',
      'توريد علف إلى التحضين — ' || COALESCE(v_feed_name,''),
      COALESCE(NEW.quantity_kg,0), 'كجم',
      COALESCE(NEW.unit_cost,0), v_total,
      'مصنع الأعلاف', 'التحضين والتسمين', auth.uid(),
      'brooding_feed_stock_movements', NEW.id, v_ref, v_br_id, NEW.notes
    );
  ELSIF NEW.movement_type = 'opening' THEN
    INSERT INTO public.brooding_movements (
      movement_no, movement_type, direction, item_name,
      quantity, unit, unit_cost, total_cost,
      created_by, source_table, source_id, notes
    ) VALUES (
      next_brooding_movement_no(), 'opening', 'IN',
      'رصيد افتتاحي — ' || COALESCE(v_feed_name,''),
      COALESCE(NEW.quantity_kg,0), 'كجم',
      COALESCE(NEW.unit_cost,0), v_total,
      auth.uid(), 'brooding_feed_stock_movements', NEW.id, NEW.notes
    );
  ELSIF NEW.movement_type = 'adjustment' THEN
    INSERT INTO public.brooding_movements (
      movement_no, movement_type, direction, item_name,
      quantity, unit, unit_cost, total_cost,
      created_by, source_table, source_id, notes
    ) VALUES (
      next_brooding_movement_no(), 'adjustment',
      CASE WHEN COALESCE(NEW.quantity_kg,0) >= 0 THEN 'IN' ELSE 'OUT' END,
      'تسوية مخزون — ' || COALESCE(v_feed_name,''),
      COALESCE(NEW.quantity_kg,0), 'كجم',
      COALESCE(NEW.unit_cost,0), v_total,
      auth.uid(), 'brooding_feed_stock_movements', NEW.id, NEW.notes
    );
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_log_brooding_feed_stock
  AFTER INSERT ON public.brooding_feed_stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.log_brooding_feed_stock_movement();
