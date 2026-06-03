
ALTER TABLE public.hatch_customers ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.hatch_batches ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.hatchery_treasury_txns ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.chick_movements ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.farm_to_hatchery_shipments ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_hatch_batches_is_test ON public.hatch_batches(is_test);
CREATE INDEX IF NOT EXISTS idx_hatch_customers_is_test ON public.hatch_customers(is_test);
CREATE INDEX IF NOT EXISTS idx_hatchery_treasury_is_test ON public.hatchery_treasury_txns(is_test);
CREATE INDEX IF NOT EXISTS idx_chick_movements_is_test ON public.chick_movements(is_test);
CREATE INDEX IF NOT EXISTS idx_farm_ship_is_test ON public.farm_to_hatchery_shipments(is_test);
