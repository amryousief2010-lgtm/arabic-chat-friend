
CREATE TABLE public.target_bonus_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  tier int NOT NULL CHECK (tier BETWEEN 1 AND 7),
  sales_amount numeric NOT NULL DEFAULT 0,
  bonus_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, tier)
);

ALTER TABLE public.target_bonus_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view bonus settings"
ON public.target_bonus_settings FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Managers can insert bonus settings"
ON public.target_bonus_settings FOR INSERT
TO authenticated
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE POLICY "Managers can update bonus settings"
ON public.target_bonus_settings FOR UPDATE
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE POLICY "Managers can delete bonus settings"
ON public.target_bonus_settings FOR DELETE
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE TRIGGER tg_target_bonus_settings_updated_at
BEFORE UPDATE ON public.target_bonus_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.target_bonus_settings (category, tier, sales_amount, bonus_amount) VALUES
('مصنعات', 1, 50000, 5),
('مصنعات', 2, 60000, 6),
('مصنعات', 3, 80000, 8),
('مصنعات', 4, 100000, 10),
('مصنعات', 5, 125000, 12),
('مصنعات', 6, 150000, 15),
('مصنعات', 7, 185000, 18),
('لحوم', 1, 100000, 5),
('لحوم', 2, 125000, 5),
('لحوم', 3, 200000, 5),
('لحوم', 4, 300000, 7),
('لحوم', 5, 300000, 7),
('لحوم', 6, 300000, 7),
('لحوم', 7, 300000, 7),
('لحوم بالعظم', 1, 0, 0),
('لحوم بالعظم', 2, 0, 0),
('لحوم بالعظم', 3, 0, 0),
('لحوم بالعظم', 4, 0, 0),
('لحوم بالعظم', 5, 0, 0),
('لحوم بالعظم', 6, 0, 0),
('لحوم بالعظم', 7, 0, 0);
