
-- Create farm_to_hatchery_shipments table
CREATE TABLE public.farm_to_hatchery_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid REFERENCES public.farm_egg_production(id) ON DELETE CASCADE,
  family_id uuid REFERENCES public.farm_families(id) ON DELETE SET NULL,
  family_number text,
  production_date date NOT NULL,
  egg_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','partial','rejected')),
  received_egg_count integer,
  damaged_count integer DEFAULT 0,
  received_at timestamptz,
  received_by uuid,
  receipt_notes text,
  hatch_batch_id uuid REFERENCES public.hatch_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fth_status ON public.farm_to_hatchery_shipments(status);
CREATE INDEX idx_fth_production ON public.farm_to_hatchery_shipments(production_id);
CREATE INDEX idx_fth_date ON public.farm_to_hatchery_shipments(production_date DESC);

ALTER TABLE public.farm_to_hatchery_shipments ENABLE ROW LEVEL SECURITY;

-- View: managers + farm + hatchery
CREATE POLICY "Authorized roles can view shipments"
ON public.farm_to_hatchery_shipments FOR SELECT
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'production_manager'::app_role,
    'farm_manager'::app_role,
    'hatchery_manager'::app_role,
    'warehouse_supervisor'::app_role
  ])
);

-- Update (receipt confirmation): hatchery + executive
CREATE POLICY "Hatchery managers can update shipments"
ON public.farm_to_hatchery_shipments FOR UPDATE
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'hatchery_manager'::app_role
  ])
);

-- Insert: managers (manual fallback)
CREATE POLICY "Authorized roles can insert shipments"
ON public.farm_to_hatchery_shipments FOR INSERT
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'farm_manager'::app_role,
    'production_manager'::app_role
  ])
);

CREATE POLICY "Authorized roles can delete pending shipments"
ON public.farm_to_hatchery_shipments FOR DELETE
USING (
  status = 'pending' AND public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'farm_manager'::app_role
  ])
);

CREATE TRIGGER set_fth_updated_at
BEFORE UPDATE ON public.farm_to_hatchery_shipments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger: auto-create / update / delete shipment when egg production changes
CREATE OR REPLACE FUNCTION public.sync_farm_to_hatchery_shipment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_number text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.farm_to_hatchery_shipments
    WHERE production_id = OLD.id AND status = 'pending';
    RETURN OLD;
  END IF;

  SELECT family_number INTO v_family_number FROM public.farm_families WHERE id = NEW.family_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.egg_count > 0 THEN
      INSERT INTO public.farm_to_hatchery_shipments
        (production_id, family_id, family_number, production_date, egg_count, status)
      VALUES (NEW.id, NEW.family_id, v_family_number, NEW.production_date, NEW.egg_count, 'pending');

      INSERT INTO public.notifications (title, description, type)
      VALUES (
        'وارد جديد من المزرعة',
        'بيض من أسرة ' || COALESCE(v_family_number,'-') || ' بتاريخ ' || NEW.production_date || ' (' || NEW.egg_count || ' بيضة) — بانتظار الاستلام بالمعمل',
        'farm_shipment'
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    UPDATE public.farm_to_hatchery_shipments
    SET egg_count = NEW.egg_count,
        production_date = NEW.production_date,
        family_id = NEW.family_id,
        family_number = v_family_number,
        updated_at = now()
    WHERE production_id = NEW.id AND status = 'pending';
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_farm_hatchery_shipment
AFTER INSERT OR UPDATE OR DELETE ON public.farm_egg_production
FOR EACH ROW EXECUTE FUNCTION public.sync_farm_to_hatchery_shipment();

-- Backfill existing production records (last 90 days) as pending shipments if none exists
INSERT INTO public.farm_to_hatchery_shipments
  (production_id, family_id, family_number, production_date, egg_count, status)
SELECT p.id, p.family_id, f.family_number, p.production_date, p.egg_count, 'pending'
FROM public.farm_egg_production p
LEFT JOIN public.farm_families f ON f.id = p.family_id
WHERE p.egg_count > 0
  AND p.production_date >= (CURRENT_DATE - INTERVAL '90 days')
  AND NOT EXISTS (
    SELECT 1 FROM public.farm_to_hatchery_shipments s WHERE s.production_id = p.id
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.farm_to_hatchery_shipments;
