CREATE TABLE IF NOT EXISTS public.hatch_batch_edit_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  batch_number text,
  operational_batch_no text,
  customer_id uuid,
  customer_name text,
  actor_id uuid,
  actor_name text,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.hatch_batch_edit_audit TO authenticated;
GRANT ALL ON public.hatch_batch_edit_audit TO service_role;

ALTER TABLE public.hatch_batch_edit_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_read_managers" ON public.hatch_batch_edit_audit
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'general_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
    OR public.has_role(auth.uid(), 'hatchery_manager'::app_role)
    OR public.has_role(auth.uid(), 'farm_manager'::app_role)
  );

CREATE POLICY "audit_insert_authenticated" ON public.hatch_batch_edit_audit
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_hatch_audit_created ON public.hatch_batch_edit_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hatch_audit_batch ON public.hatch_batch_edit_audit (batch_id);
