-- Target-page kg prices: versioned rows by effective_from + fix DEFAULT landmine.
-- Scope: sales target calculation only. Meat 390 / bone 350 unchanged.
-- Processed: 160 before 2026-09-01, 140 from 2026-09-01 onward.

-- 1) Landmine: singleton column default was 160; new inserts would silently revert.
ALTER TABLE public.sales_kg_price_settings
  ALTER COLUMN processed_price SET DEFAULT 140;

-- Keep the live singleton row on the post-Sep 2026 policy (idempotent).
UPDATE public.sales_kg_price_settings
SET
  meat_price = 390,
  bone_meat_price = 350,
  processed_price = 140,
  updated_at = now()
WHERE singleton IS TRUE
  AND (
    meat_price IS DISTINCT FROM 390
    OR bone_meat_price IS DISTINCT FROM 350
    OR processed_price IS DISTINCT FROM 140
  );

-- 2) Versioned source of truth for target kg prices.
CREATE TABLE IF NOT EXISTS public.sales_kg_price_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from date NOT NULL,
  meat_price numeric NOT NULL DEFAULT 390,
  bone_meat_price numeric NOT NULL DEFAULT 350,
  processed_price numeric NOT NULL DEFAULT 140,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_kg_price_versions_effective_from_key UNIQUE (effective_from),
  CONSTRAINT sales_kg_price_versions_prices_positive CHECK (
    meat_price >= 0 AND bone_meat_price >= 0 AND processed_price >= 0
  )
);

CREATE INDEX IF NOT EXISTS sales_kg_price_versions_effective_from_idx
  ON public.sales_kg_price_versions (effective_from DESC);

GRANT SELECT, INSERT, UPDATE ON public.sales_kg_price_versions TO authenticated;
GRANT ALL ON public.sales_kg_price_versions TO service_role;

ALTER TABLE public.sales_kg_price_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view kg price versions" ON public.sales_kg_price_versions;
CREATE POLICY "Authenticated can view kg price versions"
ON public.sales_kg_price_versions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Managers can insert kg price versions" ON public.sales_kg_price_versions;
CREATE POLICY "Managers can insert kg price versions"
ON public.sales_kg_price_versions FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'general_manager')
  OR public.has_role(auth.uid(), 'executive_manager')
  OR public.has_role(auth.uid(), 'sales_manager')
  OR public.has_role(auth.uid(), 'marketing_sales_manager')
);

DROP POLICY IF EXISTS "Managers can update kg price versions" ON public.sales_kg_price_versions;
CREATE POLICY "Managers can update kg price versions"
ON public.sales_kg_price_versions FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'general_manager')
  OR public.has_role(auth.uid(), 'executive_manager')
  OR public.has_role(auth.uid(), 'sales_manager')
  OR public.has_role(auth.uid(), 'marketing_sales_manager')
)
WITH CHECK (
  public.has_role(auth.uid(), 'general_manager')
  OR public.has_role(auth.uid(), 'executive_manager')
  OR public.has_role(auth.uid(), 'sales_manager')
  OR public.has_role(auth.uid(), 'marketing_sales_manager')
);

DROP TRIGGER IF EXISTS trg_sales_kg_price_versions_updated_at ON public.sales_kg_price_versions;
CREATE TRIGGER trg_sales_kg_price_versions_updated_at
BEFORE UPDATE ON public.sales_kg_price_versions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Historical: Aug 2026 and earlier keep processed 160. Meat/bone unchanged.
INSERT INTO public.sales_kg_price_versions (effective_from, meat_price, bone_meat_price, processed_price)
VALUES ('2020-01-01', 390, 350, 160)
ON CONFLICT (effective_from) DO UPDATE SET
  meat_price = EXCLUDED.meat_price,
  bone_meat_price = EXCLUDED.bone_meat_price,
  processed_price = EXCLUDED.processed_price,
  updated_at = now();

-- Current policy from Sep 2026: processed 140.
INSERT INTO public.sales_kg_price_versions (effective_from, meat_price, bone_meat_price, processed_price)
VALUES ('2026-09-01', 390, 350, 140)
ON CONFLICT (effective_from) DO UPDATE SET
  meat_price = EXCLUDED.meat_price,
  bone_meat_price = EXCLUDED.bone_meat_price,
  processed_price = EXCLUDED.processed_price,
  updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sales_kg_price_versions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_kg_price_versions;
  END IF;
END $$;

-- 3) Resolve prices for a calendar year/month (1-based month).
CREATE OR REPLACE FUNCTION public.get_sales_kg_prices_for_month(p_year integer, p_month integer)
RETURNS TABLE (
  meat_price numeric,
  bone_meat_price numeric,
  processed_price numeric,
  effective_from date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT v.meat_price, v.bone_meat_price, v.processed_price, v.effective_from
  FROM public.sales_kg_price_versions v
  WHERE v.effective_from <= make_date(p_year, p_month, 1)
  ORDER BY v.effective_from DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_sales_kg_prices_for_month(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sales_kg_prices_for_month(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sales_kg_prices_for_month(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_kg_prices_for_month(integer, integer) TO service_role;

===== END FILE =====

===== TYPES SNIPPET to insert into src/integrations/supabase/types.ts =====
Under Tables, before sales_kg_price_settings:
      sales_kg_price_versions: {
        Row: {
          bone_meat_price: number
          created_at: string
          effective_from: string
          id: string
          meat_price: number
          processed_price: number
          updated_at: string
        }
        Insert: {
          bone_meat_price?: number
          created_at?: string
          effective_from: string
          id?: string
          meat_price?: number
          processed_price?: number
          updated_at?: string
        }
        Update: {
          bone_meat_price?: number
          created_at?: string
          effective_from?: string
          id?: string
          meat_price?: number
          processed_price?: number
          updated_at?: string
        }
        Relationships: []
      }

Under Functions:
      get_sales_kg_prices_for_month: {
        Args: { p_month: number; p_year: number }
        Returns: {
          bone_meat_price: number
          effective_from: string
          meat_price: number
          processed_price: number
        }[]
      }
===== END TYPES =====
