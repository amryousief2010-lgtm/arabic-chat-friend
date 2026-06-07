
CREATE TABLE public.slaughter_custody_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.slaughter_custody_expense_categories TO authenticated;
GRANT ALL ON public.slaughter_custody_expense_categories TO service_role;

ALTER TABLE public.slaughter_custody_expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read custody categories"
  ON public.slaughter_custody_expense_categories FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "keeper/manager can create categories"
  ON public.slaughter_custody_expense_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'slaughterhouse_custody_keeper'::app_role)
    OR public.has_role(auth.uid(), 'slaughterhouse_manager'::app_role)
    OR public.has_role(auth.uid(), 'general_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
  );

CREATE POLICY "keeper/manager can update categories"
  ON public.slaughter_custody_expense_categories FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'slaughterhouse_custody_keeper'::app_role)
    OR public.has_role(auth.uid(), 'slaughterhouse_manager'::app_role)
    OR public.has_role(auth.uid(), 'general_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
  );
