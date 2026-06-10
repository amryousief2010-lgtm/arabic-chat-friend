
CREATE TABLE IF NOT EXISTS public.order_review_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_reviewed boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_review_status TO authenticated;
GRANT ALL ON public.order_review_status TO service_role;

ALTER TABLE public.order_review_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own order review status"
  ON public.order_review_status
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_order_review_status_user ON public.order_review_status(user_id);
CREATE INDEX IF NOT EXISTS idx_order_review_status_order ON public.order_review_status(order_id);

CREATE OR REPLACE FUNCTION public.touch_order_review_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_order_review_status_touch ON public.order_review_status;
CREATE TRIGGER trg_order_review_status_touch BEFORE UPDATE ON public.order_review_status
  FOR EACH ROW EXECUTE FUNCTION public.touch_order_review_status();

-- Allow all authenticated users on the domain to read customer name/phone for orders display
DROP POLICY IF EXISTS "Authenticated can view customers" ON public.customers;
CREATE POLICY "Authenticated can view customers"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (true);
