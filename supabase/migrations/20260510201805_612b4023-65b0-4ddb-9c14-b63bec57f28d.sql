-- History snapshots for recipe BOM totals
CREATE TABLE public.feed_recipe_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL,
  batch_size NUMERIC NOT NULL,
  total_quantity NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.feed_recipe_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated view recipe history" ON public.feed_recipe_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Feed managers manage recipe history" ON public.feed_recipe_history FOR ALL
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]));

-- Event log for production batches
CREATE TABLE public.feed_batch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  performed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_feed_batch_events_batch ON public.feed_batch_events(batch_id, created_at DESC);
ALTER TABLE public.feed_batch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated view batch events" ON public.feed_batch_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Feed managers create batch events" ON public.feed_batch_events FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role]));