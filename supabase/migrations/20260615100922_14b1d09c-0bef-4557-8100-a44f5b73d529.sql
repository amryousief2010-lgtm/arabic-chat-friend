CREATE TABLE IF NOT EXISTS public.meat_recipe_item_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_item_name TEXT NOT NULL,
  recipe_item_kind TEXT NOT NULL CHECK (recipe_item_kind IN ('raw','spice','packaging')),
  mapped_raw_item_id UUID NOT NULL REFERENCES public.meat_factory_raw_items(id) ON DELETE CASCADE,
  mapped_raw_item_name TEXT NOT NULL,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS meat_recipe_item_mappings_unique
  ON public.meat_recipe_item_mappings (lower(trim(recipe_item_name)), recipe_item_kind);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_recipe_item_mappings TO authenticated;
GRANT ALL ON public.meat_recipe_item_mappings TO service_role;

ALTER TABLE public.meat_recipe_item_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read recipe mappings"
  ON public.meat_recipe_item_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert recipe mappings"
  ON public.meat_recipe_item_mappings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update recipe mappings"
  ON public.meat_recipe_item_mappings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete recipe mappings"
  ON public.meat_recipe_item_mappings FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_meat_recipe_item_mappings_updated_at
  BEFORE UPDATE ON public.meat_recipe_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();