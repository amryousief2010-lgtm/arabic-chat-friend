
-- ===== brooding_settings (singleton) =====
CREATE TABLE public.brooding_settings (
  id boolean PRIMARY KEY DEFAULT true,
  default_chick_price numeric NOT NULL DEFAULT 1500,
  feed_cost_per_kg_phase1 numeric NOT NULL DEFAULT 20.238,
  feed_cost_per_kg_phase2 numeric NOT NULL DEFAULT 18.638,
  phase_split_months integer NOT NULL DEFAULT 4,
  low_feed_alert_kg numeric NOT NULL DEFAULT 20,
  mortality_alert_pct numeric NOT NULL DEFAULT 5,
  print_header_color text NOT NULL DEFAULT '#1b5e20',
  print_accent_color text NOT NULL DEFAULT '#e8f5e9',
  company_name text NOT NULL DEFAULT 'نعام العاصمة',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT brooding_settings_singleton CHECK (id = true)
);

GRANT SELECT, INSERT, UPDATE ON public.brooding_settings TO authenticated;
GRANT ALL ON public.brooding_settings TO service_role;

ALTER TABLE public.brooding_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read brooding settings"
  ON public.brooding_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only GM/EM can insert brooding settings"
  ON public.brooding_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

CREATE POLICY "Only GM/EM can update brooding settings"
  ON public.brooding_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
  WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

INSERT INTO public.brooding_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ===== brooding_feed_inventory =====
CREATE TABLE public.brooding_feed_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_name text NOT NULL UNIQUE,
  current_kg numeric NOT NULL DEFAULT 0,
  last_unit_cost numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brooding_feed_inventory TO authenticated;
GRANT ALL ON public.brooding_feed_inventory TO service_role;

ALTER TABLE public.brooding_feed_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read feed inventory"
  ON public.brooding_feed_inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "Only GM/EM can manage feed inventory"
  ON public.brooding_feed_inventory FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
  WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

INSERT INTO public.brooding_feed_inventory (feed_name, current_kg, last_unit_cost)
VALUES ('علف كتاكيت نعام', 80, 20.238)
ON CONFLICT (feed_name) DO NOTHING;

-- ===== brooding_feed_stock_movements (history) =====
CREATE TABLE public.brooding_feed_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id uuid NOT NULL REFERENCES public.brooding_feed_inventory(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('opening','purchase','consumption','adjustment')),
  quantity_kg numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  batch_id uuid REFERENCES public.brooding_batches(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.brooding_feed_stock_movements TO authenticated;
GRANT ALL ON public.brooding_feed_stock_movements TO service_role;

ALTER TABLE public.brooding_feed_stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read feed stock movements"
  ON public.brooding_feed_stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Only GM/EM can insert feed stock movements"
  ON public.brooding_feed_stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

-- Seed an opening movement to match the 80kg balance
INSERT INTO public.brooding_feed_stock_movements (feed_id, movement_type, quantity_kg, unit_cost, total_cost, notes)
SELECT id, 'opening', 80, 20.238, 80 * 20.238, 'رصيد افتتاحي'
FROM public.brooding_feed_inventory WHERE feed_name = 'علف كتاكيت نعام'
ON CONFLICT DO NOTHING;

-- ===== Trigger: deduct from inventory when feed is issued to a batch =====
CREATE OR REPLACE FUNCTION public.brooding_feed_deduct_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
BEGIN
  SELECT * INTO inv FROM public.brooding_feed_inventory
    WHERE feed_name = NEW.feed_name
    FOR UPDATE;
  IF FOUND THEN
    IF inv.current_kg < NEW.quantity_kg THEN
      RAISE EXCEPTION 'الرصيد المتاح من % غير كافٍ (المتاح: % كجم، المطلوب: % كجم)',
        NEW.feed_name, inv.current_kg, NEW.quantity_kg;
    END IF;
    UPDATE public.brooding_feed_inventory
      SET current_kg = current_kg - NEW.quantity_kg,
          last_unit_cost = NEW.unit_cost,
          updated_at = now()
      WHERE id = inv.id;
    INSERT INTO public.brooding_feed_stock_movements
      (feed_id, movement_type, quantity_kg, unit_cost, total_cost, batch_id, notes, created_by)
      VALUES (inv.id, 'consumption', NEW.quantity_kg, NEW.unit_cost, NEW.total_cost, NEW.batch_id, NEW.notes, NEW.created_by);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER brooding_feed_deduct_inventory_trg
AFTER INSERT ON public.brooding_feed_issuance
FOR EACH ROW EXECUTE FUNCTION public.brooding_feed_deduct_inventory();

-- ===== Trigger: maintain inventory balance when stock movement is inserted directly (opening/purchase/adjustment) =====
CREATE OR REPLACE FUNCTION public.brooding_feed_stock_apply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.movement_type IN ('purchase','opening') THEN
    UPDATE public.brooding_feed_inventory
      SET current_kg = current_kg + NEW.quantity_kg,
          last_unit_cost = COALESCE(NULLIF(NEW.unit_cost, 0), last_unit_cost),
          updated_at = now()
      WHERE id = NEW.feed_id;
  ELSIF NEW.movement_type = 'adjustment' THEN
    UPDATE public.brooding_feed_inventory
      SET current_kg = NEW.quantity_kg, updated_at = now()
      WHERE id = NEW.feed_id;
  END IF;
  -- consumption is handled by brooding_feed_deduct_inventory (which inserts the row itself)
  RETURN NEW;
END; $$;

-- Apply only when NOT consumption (to avoid double-counting when called from feed_issuance trigger)
CREATE TRIGGER brooding_feed_stock_apply_trg
AFTER INSERT ON public.brooding_feed_stock_movements
FOR EACH ROW
WHEN (NEW.movement_type <> 'consumption')
EXECUTE FUNCTION public.brooding_feed_stock_apply();

-- Re-sync inventory because seed opening was inserted BEFORE the trigger existed
UPDATE public.brooding_feed_inventory
  SET current_kg = 80, last_unit_cost = 20.238
  WHERE feed_name = 'علف كتاكيت نعام';
