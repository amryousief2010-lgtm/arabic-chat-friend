CREATE TABLE IF NOT EXISTS public.zodex_sync_state (
  id boolean PRIMARY KEY DEFAULT true,
  last_successful_zodex_sync_at timestamptz,
  last_full_review_at timestamptz,
  last_sync_mode text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zodex_sync_state_singleton CHECK (id)
);

GRANT SELECT ON public.zodex_sync_state TO authenticated;
GRANT ALL ON public.zodex_sync_state TO service_role;

ALTER TABLE public.zodex_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read zodex sync state"
ON public.zodex_sync_state FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_zodex_sync_state_updated_at
BEFORE UPDATE ON public.zodex_sync_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.zodex_sync_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.zodex_sync_runs
  ADD COLUMN IF NOT EXISTS sync_mode text,
  ADD COLUMN IF NOT EXISTS window_from timestamptz,
  ADD COLUMN IF NOT EXISTS window_to timestamptz,
  ADD COLUMN IF NOT EXISTS pages_fetched integer,
  ADD COLUMN IF NOT EXISTS orders_compared integer,
  ADD COLUMN IF NOT EXISTS unresolved_count integer;