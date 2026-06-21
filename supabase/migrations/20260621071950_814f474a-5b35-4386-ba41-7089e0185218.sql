
CREATE TABLE public.menu_price_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id text NOT NULL,
  item_name_ar text NOT NULL,
  item_name_en text,
  category text,
  old_price numeric,
  new_price numeric NOT NULL,
  unit text,
  reason text,
  notes text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.menu_price_changes TO authenticated;
GRANT ALL ON public.menu_price_changes TO service_role;

ALTER TABLE public.menu_price_changes ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read the menu price history (needed to render current prices)
CREATE POLICY "Authenticated read menu price changes"
  ON public.menu_price_changes FOR SELECT TO authenticated
  USING (true);

-- Only general/executive managers can insert price changes
CREATE POLICY "Managers insert menu price changes"
  ON public.menu_price_changes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
  );

CREATE INDEX idx_menu_price_changes_item ON public.menu_price_changes(item_id, created_at DESC);
CREATE INDEX idx_menu_price_changes_created ON public.menu_price_changes(created_at DESC);
