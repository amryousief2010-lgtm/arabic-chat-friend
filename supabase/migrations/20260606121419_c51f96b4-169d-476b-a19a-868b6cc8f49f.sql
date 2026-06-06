
-- ============== ENUMS ==============
CREATE TYPE public.treasury_kind AS ENUM ('lab','slaughter','farm','feed_factory','hatchery','meat_factory','main_warehouse');
CREATE TYPE public.transfer_status AS ENUM ('pending','approved','rejected','cancelled');
CREATE TYPE public.transfer_settlement_status AS ENUM ('unpaid','partial','paid');
CREATE TYPE public.transfer_payment_method AS ENUM ('cash','vodafone_cash','instapay','bank_transfer');

-- ============== updated_at trigger fn ==============
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============== TABLE: treasury_transfers ==============
CREATE TABLE public.treasury_transfers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_treasury public.treasury_kind NOT NULL,
  to_treasury public.treasury_kind NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT,
  notes TEXT,
  affects_cash_now BOOLEAN NOT NULL DEFAULT true,
  is_historical BOOLEAN NOT NULL DEFAULT false,
  status public.transfer_status NOT NULL DEFAULT 'pending',
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  settlement_status public.transfer_settlement_status NOT NULL DEFAULT 'unpaid',
  rejection_reason TEXT,
  deletion_reason TEXT,
  deleted_at TIMESTAMPTZ,
  attachment_url TEXT,
  created_by UUID,
  approved_by UUID,
  rejected_by UUID,
  deleted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_treasury <> to_treasury)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treasury_transfers TO authenticated;
GRANT ALL ON public.treasury_transfers TO service_role;
ALTER TABLE public.treasury_transfers ENABLE ROW LEVEL SECURITY;

-- ============== TABLE: treasury_transfer_settlements ==============
CREATE TABLE public.treasury_transfer_settlements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transfer_id UUID NOT NULL REFERENCES public.treasury_transfers(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method public.transfer_payment_method NOT NULL DEFAULT 'cash',
  settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  status public.transfer_status NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  attachment_url TEXT,
  recorded_by UUID,
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treasury_transfer_settlements TO authenticated;
GRANT ALL ON public.treasury_transfer_settlements TO service_role;
ALTER TABLE public.treasury_transfer_settlements ENABLE ROW LEVEL SECURITY;

-- ============== TABLE: treasury_transfer_audit_log ==============
CREATE TABLE public.treasury_transfer_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  actor_id UUID,
  reason TEXT,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.treasury_transfer_audit_log TO authenticated;
GRANT ALL ON public.treasury_transfer_audit_log TO service_role;
ALTER TABLE public.treasury_transfer_audit_log ENABLE ROW LEVEL SECURITY;

-- ============== Permission helpers ==============
CREATE OR REPLACE FUNCTION public.can_approve_treasury_transfer(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text IN ('general_manager','executive_manager','lab_treasury_approver','slaughterhouse_manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_treasury_transfer(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text IN ('general_manager','executive_manager','accountant','lab_treasury_approver','lab_treasury_keeper','production_manager','slaughterhouse_manager')
  );
$$;

-- ============== RLS POLICIES ==============
CREATE POLICY "tt_select" ON public.treasury_transfers FOR SELECT TO authenticated
  USING (public.can_view_treasury_transfer(auth.uid()));
CREATE POLICY "tt_insert" ON public.treasury_transfers FOR INSERT TO authenticated
  WITH CHECK (public.can_view_treasury_transfer(auth.uid()));
CREATE POLICY "tt_update" ON public.treasury_transfers FOR UPDATE TO authenticated
  USING (public.can_approve_treasury_transfer(auth.uid()) OR created_by = auth.uid())
  WITH CHECK (public.can_approve_treasury_transfer(auth.uid()) OR created_by = auth.uid());
CREATE POLICY "tt_delete" ON public.treasury_transfers FOR DELETE TO authenticated
  USING (public.can_approve_treasury_transfer(auth.uid()));

CREATE POLICY "tts_select" ON public.treasury_transfer_settlements FOR SELECT TO authenticated
  USING (public.can_view_treasury_transfer(auth.uid()));
CREATE POLICY "tts_insert" ON public.treasury_transfer_settlements FOR INSERT TO authenticated
  WITH CHECK (public.can_view_treasury_transfer(auth.uid()));
CREATE POLICY "tts_update" ON public.treasury_transfer_settlements FOR UPDATE TO authenticated
  USING (public.can_approve_treasury_transfer(auth.uid()) OR recorded_by = auth.uid())
  WITH CHECK (public.can_approve_treasury_transfer(auth.uid()) OR recorded_by = auth.uid());
CREATE POLICY "tts_delete" ON public.treasury_transfer_settlements FOR DELETE TO authenticated
  USING (public.can_approve_treasury_transfer(auth.uid()));

CREATE POLICY "ttal_select" ON public.treasury_transfer_audit_log FOR SELECT TO authenticated
  USING (public.can_view_treasury_transfer(auth.uid()));
CREATE POLICY "ttal_insert" ON public.treasury_transfer_audit_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============== updated_at triggers ==============
CREATE TRIGGER trg_tt_touch BEFORE UPDATE ON public.treasury_transfers
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER trg_tts_touch BEFORE UPDATE ON public.treasury_transfer_settlements
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ============== Audit trigger fn for transfers ==============
CREATE OR REPLACE FUNCTION public.tg_audit_treasury_transfer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.treasury_transfer_audit_log(entity_type,entity_id,action,actor_id,after_state)
    VALUES ('treasury_transfer', NEW.id, 'create', NEW.created_by, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.treasury_transfer_audit_log(entity_type,entity_id,action,actor_id,before_state,after_state,reason)
    VALUES ('treasury_transfer', NEW.id, 'update', auth.uid(), to_jsonb(OLD), to_jsonb(NEW),
            COALESCE(NEW.rejection_reason, NEW.deletion_reason));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.treasury_transfer_audit_log(entity_type,entity_id,action,actor_id,before_state,reason)
    VALUES ('treasury_transfer', OLD.id, 'delete', auth.uid(), to_jsonb(OLD), OLD.deletion_reason);
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;

CREATE TRIGGER trg_tt_audit AFTER INSERT OR UPDATE OR DELETE ON public.treasury_transfers
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_treasury_transfer();

-- ============== Audit + auto-compute trigger for settlements ==============
CREATE OR REPLACE FUNCTION public.tg_audit_treasury_settlement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer_id UUID;
  v_total NUMERIC(14,2);
  v_amount NUMERIC(14,2);
  v_status public.transfer_settlement_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.treasury_transfer_audit_log(entity_type,entity_id,action,actor_id,after_state)
    VALUES ('treasury_transfer_settlement', NEW.id, 'create', NEW.recorded_by, to_jsonb(NEW));
    v_transfer_id := NEW.transfer_id;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.treasury_transfer_audit_log(entity_type,entity_id,action,actor_id,before_state,after_state,reason)
    VALUES ('treasury_transfer_settlement', NEW.id, 'update', auth.uid(), to_jsonb(OLD), to_jsonb(NEW), NEW.rejection_reason);
    v_transfer_id := NEW.transfer_id;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.treasury_transfer_audit_log(entity_type,entity_id,action,actor_id,before_state)
    VALUES ('treasury_transfer_settlement', OLD.id, 'delete', auth.uid(), to_jsonb(OLD));
    v_transfer_id := OLD.transfer_id;
  END IF;

  -- recompute paid_amount and settlement_status from approved settlements
  SELECT COALESCE(SUM(amount),0) INTO v_total
  FROM public.treasury_transfer_settlements
  WHERE transfer_id = v_transfer_id AND status = 'approved';

  SELECT amount INTO v_amount FROM public.treasury_transfers WHERE id = v_transfer_id;

  IF v_total <= 0 THEN v_status := 'unpaid';
  ELSIF v_total >= v_amount THEN v_status := 'paid';
  ELSE v_status := 'partial';
  END IF;

  UPDATE public.treasury_transfers
  SET paid_amount = v_total, settlement_status = v_status
  WHERE id = v_transfer_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_tts_audit AFTER INSERT OR UPDATE OR DELETE ON public.treasury_transfer_settlements
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_treasury_settlement();

-- ============== VIEW: inter-treasury net balances ==============
CREATE OR REPLACE VIEW public.v_treasury_inter_balances AS
SELECT
  from_treasury,
  to_treasury,
  COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
  COALESCE(SUM(amount) FILTER (WHERE status = 'approved'),0) AS total_advanced,
  COALESCE(SUM(paid_amount) FILTER (WHERE status = 'approved'),0) AS total_settled,
  COALESCE(SUM(amount - paid_amount) FILTER (WHERE status = 'approved'),0) AS net_outstanding
FROM public.treasury_transfers
WHERE deleted_at IS NULL
GROUP BY from_treasury, to_treasury;

GRANT SELECT ON public.v_treasury_inter_balances TO authenticated;
