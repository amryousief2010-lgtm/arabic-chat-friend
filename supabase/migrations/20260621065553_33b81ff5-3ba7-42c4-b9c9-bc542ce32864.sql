
CREATE TABLE public.warehouse_manual_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('supply','dispatch','both')),
  name text NOT NULL,
  party_type text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX warehouse_manual_parties_unique_name ON public.warehouse_manual_parties (kind, lower(name));

GRANT SELECT, INSERT, UPDATE ON public.warehouse_manual_parties TO authenticated;
GRANT ALL ON public.warehouse_manual_parties TO service_role;

ALTER TABLE public.warehouse_manual_parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view manual parties"
ON public.warehouse_manual_parties FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authorized roles can add manual parties"
ON public.warehouse_manual_parties FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'general_manager')
  OR public.has_role(auth.uid(), 'executive_manager')
  OR public.has_role(auth.uid(), 'warehouse_supervisor')
);

CREATE POLICY "Authorized roles can update manual parties"
ON public.warehouse_manual_parties FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'general_manager')
  OR public.has_role(auth.uid(), 'executive_manager')
  OR public.has_role(auth.uid(), 'warehouse_supervisor')
)
WITH CHECK (
  public.has_role(auth.uid(), 'general_manager')
  OR public.has_role(auth.uid(), 'executive_manager')
  OR public.has_role(auth.uid(), 'warehouse_supervisor')
);

CREATE TRIGGER trg_warehouse_manual_parties_updated_at
BEFORE UPDATE ON public.warehouse_manual_parties
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
