
CREATE TABLE IF NOT EXISTS public.zodex_match_decisions (
  id uuid primary key default gen_random_uuid(),
  bill_no text not null,
  order_id uuid not null,
  action text not null check (action in ('confirmed','rejected')),
  reason text,
  confidence_at_decision numeric,
  decided_by uuid,
  decided_at timestamptz not null default now(),
  unique (bill_no, order_id)
);

CREATE INDEX IF NOT EXISTS zodex_match_decisions_bill_idx ON public.zodex_match_decisions(bill_no);
CREATE INDEX IF NOT EXISTS zodex_match_decisions_order_idx ON public.zodex_match_decisions(order_id);

GRANT SELECT, INSERT ON public.zodex_match_decisions TO authenticated;
GRANT ALL ON public.zodex_match_decisions TO service_role;

ALTER TABLE public.zodex_match_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers/Marketing/Warehouse can view match decisions"
  ON public.zodex_match_decisions FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'marketing_sales_manager') OR
    public.has_role(auth.uid(), 'sales_moderator') OR
    public.has_role(auth.uid(), 'warehouse_supervisor')
  );

CREATE POLICY "Managers/Marketing/Warehouse can insert match decisions"
  ON public.zodex_match_decisions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'marketing_sales_manager') OR
    public.has_role(auth.uid(), 'sales_moderator') OR
    public.has_role(auth.uid(), 'warehouse_supervisor')
  );
