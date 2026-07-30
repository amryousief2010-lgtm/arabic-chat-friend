CREATE TABLE IF NOT EXISTS public.zodex_order_review_dismissals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique,
  reason text,
  dismissed_by uuid,
  created_at timestamptz not null default now()
);

GRANT SELECT, INSERT, DELETE ON public.zodex_order_review_dismissals TO authenticated;
GRANT ALL ON public.zodex_order_review_dismissals TO service_role;

ALTER TABLE public.zodex_order_review_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view zodex order dismissals"
ON public.zodex_order_review_dismissals FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'general_manager'::app_role) OR
  has_role(auth.uid(), 'executive_manager'::app_role) OR
  has_role(auth.uid(), 'marketing_sales_manager'::app_role) OR
  has_role(auth.uid(), 'sales_manager'::app_role) OR
  has_role(auth.uid(), 'warehouse_supervisor'::app_role)
);

CREATE POLICY "Managers can add zodex order dismissals"
ON public.zodex_order_review_dismissals FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'general_manager'::app_role) OR
  has_role(auth.uid(), 'executive_manager'::app_role) OR
  has_role(auth.uid(), 'marketing_sales_manager'::app_role) OR
  has_role(auth.uid(), 'sales_manager'::app_role) OR
  has_role(auth.uid(), 'warehouse_supervisor'::app_role)
);

CREATE POLICY "Managers can remove zodex order dismissals"
ON public.zodex_order_review_dismissals FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'general_manager'::app_role) OR
  has_role(auth.uid(), 'executive_manager'::app_role)
);