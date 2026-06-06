
CREATE TABLE IF NOT EXISTS public.hatchery_print_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name text,
  report_type text NOT NULL,
  target_ref text,
  target_label text,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.hatchery_print_audit TO authenticated;
GRANT ALL ON public.hatchery_print_audit TO service_role;
ALTER TABLE public.hatchery_print_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY hpa_insert ON public.hatchery_print_audit FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY hpa_view ON public.hatchery_print_audit FOR SELECT TO authenticated USING (true);
