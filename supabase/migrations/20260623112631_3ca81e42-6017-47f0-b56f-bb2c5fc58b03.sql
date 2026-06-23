
CREATE TABLE public.warehouse_archive_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  warehouse_id UUID,
  warehouse_name TEXT,
  cutoff_date DATE NOT NULL,
  archived_movements_count INTEGER NOT NULL DEFAULT 0,
  archived_reservations_count INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  performed_by UUID REFERENCES auth.users(id),
  performed_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.warehouse_archive_audit TO authenticated;
GRANT ALL ON public.warehouse_archive_audit TO service_role;

ALTER TABLE public.warehouse_archive_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth can view archive audit"
ON public.warehouse_archive_audit
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "managers can insert archive audit"
ON public.warehouse_archive_audit
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'general_manager'::app_role)
  OR public.has_role(auth.uid(), 'executive_manager'::app_role)
);
