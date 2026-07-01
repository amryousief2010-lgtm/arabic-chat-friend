
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS communication_channel text,
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS campaign_name text;

CREATE TABLE IF NOT EXISTS public.social_media_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
  expense_type text NOT NULL,
  platform text,
  campaign_name text,
  employee_name text,
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  notes text,
  attachment_url text,
  is_approved boolean NOT NULL DEFAULT false,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sme_date ON public.social_media_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_sme_type ON public.social_media_expenses(expense_type);
CREATE INDEX IF NOT EXISTS idx_sme_approved ON public.social_media_expenses(is_approved);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_media_expenses TO authenticated;
GRANT ALL ON public.social_media_expenses TO service_role;

ALTER TABLE public.social_media_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sme_managers_select" ON public.social_media_expenses
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'marketing_sales_manager')
  );

CREATE POLICY "sme_managers_insert" ON public.social_media_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'marketing_sales_manager')
  );

CREATE POLICY "sme_managers_update" ON public.social_media_expenses
  FOR UPDATE TO authenticated
  USING (
    (created_by = auth.uid() AND is_approved = false)
    OR public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'marketing_sales_manager')
  )
  WITH CHECK (
    (created_by = auth.uid() AND is_approved = false)
    OR public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'marketing_sales_manager')
  );

CREATE POLICY "sme_managers_delete" ON public.social_media_expenses
  FOR DELETE TO authenticated
  USING (
    is_approved = false AND (
      created_by = auth.uid()
      OR public.has_role(auth.uid(),'general_manager')
      OR public.has_role(auth.uid(),'executive_manager')
      OR public.has_role(auth.uid(),'marketing_sales_manager')
    )
  );

CREATE OR REPLACE FUNCTION public.tg_sme_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sme_touch ON public.social_media_expenses;
CREATE TRIGGER trg_sme_touch
  BEFORE UPDATE ON public.social_media_expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_sme_touch();
