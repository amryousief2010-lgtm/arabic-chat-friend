CREATE TABLE public.slaughter_live_stock_adjustments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  adjustment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  new_balance INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.slaughter_live_stock_adjustments TO authenticated;
GRANT ALL ON public.slaughter_live_stock_adjustments TO service_role;

ALTER TABLE public.slaughter_live_stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view adjustments"
ON public.slaughter_live_stock_adjustments
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'general_manager'::app_role)
  OR public.has_role(auth.uid(), 'executive_manager'::app_role)
  OR public.has_role(auth.uid(), 'slaughterhouse_manager'::app_role)
);

CREATE POLICY "Managers insert adjustments"
ON public.slaughter_live_stock_adjustments
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'general_manager'::app_role)
  OR public.has_role(auth.uid(), 'executive_manager'::app_role)
);