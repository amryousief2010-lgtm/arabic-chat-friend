CREATE TABLE IF NOT EXISTS public.hatch_batch_import_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_by_name text,
  source_filename text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  summary jsonb,
  errors jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.hatch_batch_import_log TO authenticated;
GRANT ALL ON public.hatch_batch_import_log TO service_role;

ALTER TABLE public.hatch_batch_import_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_view_hatch_batch_import_log"
  ON public.hatch_batch_import_log FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "managers_insert_hatch_batch_import_log"
  ON public.hatch_batch_import_log FOR INSERT
  TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'hatchery_manager'::app_role,
    'farm_manager'::app_role,
    'production_manager'::app_role
  ]));