
-- ============ FARM TABLES ============
CREATE TABLE public.farm_families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_number TEXT NOT NULL UNIQUE,
  pen TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  female_count INTEGER NOT NULL DEFAULT 0,
  male_count INTEGER NOT NULL DEFAULT 0,
  start_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.farm_egg_production (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_date DATE NOT NULL,
  family_id UUID REFERENCES public.farm_families(id) ON DELETE CASCADE,
  egg_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_farm_egg_date ON public.farm_egg_production(production_date);
CREATE INDEX idx_farm_egg_family ON public.farm_egg_production(family_id);

CREATE TABLE public.farm_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_date DATE NOT NULL,
  family_id UUID REFERENCES public.farm_families(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  damaged INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_farm_transfers_date ON public.farm_transfers(transfer_date);

CREATE TABLE public.farm_feed_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_date DATE NOT NULL,
  feed_type TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'كجم',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.farm_medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  med_date DATE NOT NULL,
  name TEXT NOT NULL,
  dose TEXT,
  family_id UUID REFERENCES public.farm_families(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ HATCHERY TABLES ============
CREATE TABLE public.hatch_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  customer_type TEXT NOT NULL DEFAULT 'external',
  incubation_price NUMERIC NOT NULL DEFAULT 150,
  infertile_price NUMERIC NOT NULL DEFAULT 50,
  hatcher_price NUMERIC NOT NULL DEFAULT 100,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.hatch_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number TEXT NOT NULL UNIQUE,
  receive_date DATE NOT NULL,
  customer_id UUID REFERENCES public.hatch_customers(id) ON DELETE SET NULL,
  machine TEXT,
  received_eggs INTEGER NOT NULL DEFAULT 0,
  net_eggs INTEGER NOT NULL DEFAULT 0,
  entry_date DATE,
  candle1_date DATE,
  candle1_fertile INTEGER DEFAULT 0,
  candle1_infertile INTEGER DEFAULT 0,
  candle2_date DATE,
  candle2_fertile INTEGER DEFAULT 0,
  candle2_dead INTEGER DEFAULT 0,
  exit_date DATE,
  hatched_chicks INTEGER DEFAULT 0,
  hatcher_dead INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hatch_batches_date ON public.hatch_batches(receive_date);
CREATE INDEX idx_hatch_batches_customer ON public.hatch_batches(customer_id);

CREATE TABLE public.hatch_daily_ops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  op_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'normal',
  capacity INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.hatch_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maint_date DATE NOT NULL,
  maint_type TEXT NOT NULL DEFAULT 'periodic',
  machine TEXT,
  action TEXT NOT NULL,
  cost NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.chick_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_date DATE NOT NULL,
  source TEXT NOT NULL,
  incoming INTEGER NOT NULL DEFAULT 0,
  outgoing INTEGER NOT NULL DEFAULT 0,
  dead INTEGER NOT NULL DEFAULT 0,
  sold INTEGER NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ TRIGGERS ============
CREATE TRIGGER trg_farm_families_updated BEFORE UPDATE ON public.farm_families
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hatch_customers_updated BEFORE UPDATE ON public.hatch_customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hatch_batches_updated BEFORE UPDATE ON public.hatch_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ RLS ============
ALTER TABLE public.farm_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_egg_production ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_feed_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatch_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatch_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatch_daily_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatch_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chick_movements ENABLE ROW LEVEL SECURITY;

-- Helper: any authorized farm/hatchery role
-- Roles allowed to manage: general_manager, executive_manager, farm_manager, production_manager, quality_manager
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'farm_families','farm_egg_production','farm_transfers','farm_feed_log','farm_medications',
    'hatch_customers','hatch_batches','hatch_daily_ops','hatch_maintenance','chick_movements'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('CREATE POLICY "auth_view_%s" ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format($p$CREATE POLICY "manage_%s" ON public.%I FOR ALL TO authenticated 
      USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'farm_manager'::app_role,'production_manager'::app_role,'quality_manager'::app_role]))
      WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'farm_manager'::app_role,'production_manager'::app_role,'quality_manager'::app_role]))$p$, t, t);
  END LOOP;
END$$;
