ALTER TABLE public.stock_replenishment_log
ADD COLUMN IF NOT EXISTS half_kg_bags integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS kg_bags integer NOT NULL DEFAULT 0;