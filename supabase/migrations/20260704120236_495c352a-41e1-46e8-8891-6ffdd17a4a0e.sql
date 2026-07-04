
CREATE TABLE public.bostta_delivery_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  shipments_total int NOT NULL DEFAULT 0,
  updated_count int NOT NULL DEFAULT 0,
  product_diffs_count int NOT NULL DEFAULT 0,
  unmatched_count int NOT NULL DEFAULT 0,
  warnings_count int NOT NULL DEFAULT 0,
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.bostta_delivery_uploads TO authenticated;
GRANT ALL ON public.bostta_delivery_uploads TO service_role;

ALTER TABLE public.bostta_delivery_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read uploads"
  ON public.bostta_delivery_uploads FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated can insert uploads"
  ON public.bostta_delivery_uploads FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = uploaded_by OR uploaded_by IS NULL);
