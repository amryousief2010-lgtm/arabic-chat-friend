
CREATE TABLE public.mother_farm_feed_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bag_weight_kg numeric NOT NULL DEFAULT 40,
  daily_consumption_per_bird_kg numeric NOT NULL DEFAULT 2,
  low_stock_threshold_kg numeric NOT NULL DEFAULT 600,
  current_bird_count integer NOT NULL DEFAULT 59,
  consumption_start_date date NOT NULL DEFAULT '2026-06-06',
  location_text text NOT NULL DEFAULT 'الريف الأوروبي – طريق مصر إسكندرية الصحراوي',
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.mother_farm_feed_settings TO authenticated;
GRANT ALL ON public.mother_farm_feed_settings TO service_role;
ALTER TABLE public.mother_farm_feed_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view feed settings" ON public.mother_farm_feed_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage feed settings" ON public.mother_farm_feed_settings FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'general_manager') OR
  public.has_role(auth.uid(), 'executive_manager') OR
  public.has_role(auth.uid(), 'warehouse_supervisor')
)
WITH CHECK (
  public.has_role(auth.uid(), 'general_manager') OR
  public.has_role(auth.uid(), 'executive_manager') OR
  public.has_role(auth.uid(), 'warehouse_supervisor')
);

INSERT INTO public.mother_farm_feed_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE public.mother_farm_feed_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
  movement_type text NOT NULL CHECK (movement_type IN ('in','daily_consumption','adjust_up','adjust_down')),
  bags numeric,
  weight_kg numeric NOT NULL CHECK (weight_kg >= 0),
  supplier text,
  notes text,
  reason text,
  consumption_day date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_mff_consumption_day ON public.mother_farm_feed_movements (consumption_day)
  WHERE movement_type = 'daily_consumption';
CREATE INDEX idx_mff_date ON public.mother_farm_feed_movements (movement_date DESC);

GRANT SELECT, INSERT ON public.mother_farm_feed_movements TO authenticated;
GRANT ALL ON public.mother_farm_feed_movements TO service_role;
ALTER TABLE public.mother_farm_feed_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view feed moves" ON public.mother_farm_feed_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert feed moves" ON public.mother_farm_feed_movements FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'general_manager') OR
  public.has_role(auth.uid(), 'executive_manager') OR
  public.has_role(auth.uid(), 'warehouse_supervisor')
);

CREATE OR REPLACE VIEW public.v_mother_farm_feed_balance AS
SELECT
  COALESCE(SUM(CASE WHEN movement_type IN ('in','adjust_up') THEN weight_kg
                    WHEN movement_type IN ('daily_consumption','adjust_down') THEN -weight_kg
                    ELSE 0 END), 0)::numeric AS balance_kg,
  (SELECT created_at FROM public.mother_farm_feed_movements WHERE movement_type = 'in' ORDER BY created_at DESC LIMIT 1) AS last_supply_at,
  (SELECT weight_kg FROM public.mother_farm_feed_movements WHERE movement_type = 'in' ORDER BY created_at DESC LIMIT 1) AS last_supply_kg,
  (SELECT consumption_day FROM public.mother_farm_feed_movements WHERE movement_type = 'daily_consumption' ORDER BY consumption_day DESC LIMIT 1) AS last_consumption_day,
  (SELECT weight_kg FROM public.mother_farm_feed_movements WHERE movement_type = 'daily_consumption' ORDER BY consumption_day DESC LIMIT 1) AS last_consumption_kg
FROM public.mother_farm_feed_movements;

GRANT SELECT ON public.v_mother_farm_feed_balance TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_mother_farm_daily_consumption()
RETURNS TABLE (days_added integer, total_deducted_kg numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD;
  start_day date;
  last_day date;
  today_cairo date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  iter date;
  daily_kg numeric;
  cur_balance numeric;
  to_deduct numeric;
  cnt integer := 0;
  total numeric := 0;
BEGIN
  SELECT * INTO s FROM public.mother_farm_feed_settings LIMIT 1;
  IF s IS NULL THEN
    RETURN QUERY SELECT 0, 0::numeric; RETURN;
  END IF;

  daily_kg := s.current_bird_count * s.daily_consumption_per_bird_kg;

  SELECT MAX(consumption_day) INTO last_day FROM public.mother_farm_feed_movements WHERE movement_type='daily_consumption';
  IF last_day IS NULL THEN start_day := s.consumption_start_date;
  ELSE start_day := last_day + 1; END IF;

  IF start_day > today_cairo THEN
    RETURN QUERY SELECT 0, 0::numeric; RETURN;
  END IF;

  iter := start_day;
  WHILE iter <= today_cairo LOOP
    SELECT COALESCE(SUM(CASE WHEN movement_type IN ('in','adjust_up') THEN weight_kg
                             WHEN movement_type IN ('daily_consumption','adjust_down') THEN -weight_kg
                             ELSE 0 END),0)
      INTO cur_balance FROM public.mother_farm_feed_movements;

    IF cur_balance <= 0 THEN EXIT; END IF;

    to_deduct := LEAST(daily_kg, cur_balance);

    BEGIN
      INSERT INTO public.mother_farm_feed_movements
        (movement_date, movement_type, weight_kg, consumption_day, notes)
      VALUES
        (iter, 'daily_consumption', to_deduct, iter,
         CASE WHEN to_deduct < daily_kg
              THEN 'استهلاك يومي لعلف الأمهات — رصيد غير كافٍ (تم خصم المتاح فقط)'
              ELSE 'استهلاك يومي لعلف الأمهات' END);
      cnt := cnt + 1;
      total := total + to_deduct;
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    iter := iter + 1;
  END LOOP;

  RETURN QUERY SELECT cnt, total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_mother_farm_daily_consumption() TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_mff_settings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_mff_settings_touch BEFORE UPDATE ON public.mother_farm_feed_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_mff_settings();
