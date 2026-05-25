
-- ============================================================
-- Phase 5D: Manager-Approved Stock Reconciliation Planning
-- Planning-only. No stock writes. No inventory movements.
-- No DELETE policy on proposals.
-- ============================================================

-- Warehouse id constants (used in views):
--   Main:   5ec781b5-685b-4806-b59a-83a79ea5662c (المخزن الرئيسي - المقر)
--   Agouza: a970d469-37df-40e1-b99f-a49195a3778e (مخزن فرع العجوزة)

-- ---------- snapshot table column additions ----------
ALTER TABLE public.products_stock_snapshot_5d
  ADD COLUMN IF NOT EXISTS main_stock_before numeric,
  ADD COLUMN IF NOT EXISTS agouza_stock_before numeric,
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS reason text;

-- ---------- v_stock_reconciliation (sales-inventory only) ----------
DROP VIEW IF EXISTS public.v_stock_reconciliation CASCADE;
CREATE VIEW public.v_stock_reconciliation AS
WITH inv AS (
  SELECT
    ii.product_id,
    SUM(CASE WHEN ii.warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c' THEN COALESCE(ii.stock,0) ELSE 0 END) AS main_stock,
    SUM(CASE WHEN ii.warehouse_id = 'a970d469-37df-40e1-b99f-a49195a3778e' THEN COALESCE(ii.stock,0) ELSE 0 END) AS agouza_stock,
    SUM(COALESCE(ii.stock,0)) AS total_sales_inventory_stock,
    bool_or(ii.warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c') AS has_main_row,
    bool_or(ii.warehouse_id = 'a970d469-37df-40e1-b99f-a49195a3778e') AS has_agouza_row
  FROM public.inventory_items ii
  WHERE ii.product_id IS NOT NULL
    AND ii.warehouse_id IN (
      '5ec781b5-685b-4806-b59a-83a79ea5662c',
      'a970d469-37df-40e1-b99f-a49195a3778e'
    )
  GROUP BY ii.product_id
)
SELECT
  p.id                                AS product_id,
  p.barcode,
  p.name                              AS product_name,
  p.is_active,
  COALESCE(p.stock,0)::numeric        AS legacy_stock,
  COALESCE(inv.main_stock,0)          AS main_warehouse_stock,
  COALESCE(inv.agouza_stock,0)        AS agouza_warehouse_stock,
  COALESCE(inv.total_sales_inventory_stock,0) AS total_sales_inventory_stock,
  (COALESCE(p.stock,0)::numeric - COALESCE(inv.total_sales_inventory_stock,0)) AS difference,
  COALESCE(inv.has_main_row,false)    AS has_main_row,
  COALESCE(inv.has_agouza_row,false)  AS has_agouza_row
FROM public.products p
LEFT JOIN inv ON inv.product_id = p.id;

-- ---------- v_agouza_readiness ----------
DROP VIEW IF EXISTS public.v_agouza_readiness CASCADE;
CREATE VIEW public.v_agouza_readiness AS
WITH demand AS (
  SELECT oi.product_id, SUM(COALESCE(oi.quantity,0)) AS demand_qty
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.shipping_company = 'العاصمة'
    AND o.status = 'pending'
    AND oi.product_id IS NOT NULL
  GROUP BY oi.product_id
),
inv AS (
  SELECT
    ii.product_id,
    SUM(CASE WHEN ii.warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c' THEN COALESCE(ii.stock,0) ELSE 0 END) AS main_stock,
    SUM(CASE WHEN ii.warehouse_id = 'a970d469-37df-40e1-b99f-a49195a3778e' THEN COALESCE(ii.stock,0) ELSE 0 END) AS agouza_stock
  FROM public.inventory_items ii
  WHERE ii.product_id IS NOT NULL
  GROUP BY ii.product_id
)
SELECT
  p.id                            AS product_id,
  p.barcode,
  p.name                          AS product_name,
  p.is_active,
  COALESCE(d.demand_qty,0)        AS demand_qty,
  COALESCE(inv.agouza_stock,0)    AS agouza_stock,
  COALESCE(inv.main_stock,0)      AS main_stock,
  GREATEST(COALESCE(d.demand_qty,0) - COALESCE(inv.agouza_stock,0), 0) AS shortage,
  LEAST(
    GREATEST(COALESCE(d.demand_qty,0) - COALESCE(inv.agouza_stock,0), 0),
    COALESCE(inv.main_stock,0)
  ) AS suggested_transfer,
  (COALESCE(inv.main_stock,0) >= GREATEST(COALESCE(d.demand_qty,0) - COALESCE(inv.agouza_stock,0), 0)) AS main_sufficient
FROM demand d
JOIN public.products p ON p.id = d.product_id
LEFT JOIN inv ON inv.product_id = p.id;

-- ---------- stock_reconciliation_proposals table ----------
CREATE TABLE IF NOT EXISTS public.stock_reconciliation_proposals (
  proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id),
  barcode text,
  product_name text,
  legacy_stock numeric,
  main_warehouse_stock numeric,
  agouza_warehouse_stock numeric,
  total_sales_inventory_stock numeric,
  difference numeric,
  issue_type text NOT NULL CHECK (issue_type IN (
    'legacy_gt_inventory','inventory_gt_legacy','missing_inventory_row',
    'inactive_product','missing_barcode','agouza_zero_with_demand','matched'
  )),
  proposed_action text NOT NULL CHECK (proposed_action IN (
    'investigate','no_action','adjust_main_inventory_later',
    'adjust_agouza_inventory_later','transfer_main_to_agouza_later',
    'mark_product_blocked','fix_barcode_first','ignore_legacy_stock_later',
    'manager_decision_required'
  )),
  proposed_adjustment_qty numeric,
  target_warehouse_id uuid REFERENCES public.warehouses(id),
  reason text,
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  requires_manager_approval boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','pending_review','approved_for_future_execution','rejected','dismissed'
  )),
  created_by uuid,
  reviewed_by uuid,
  approved_by uuid,
  rejected_by uuid,
  audit_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  dismissed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_open_per_product_issue
  ON public.stock_reconciliation_proposals (product_id, issue_type)
  WHERE status IN ('draft','pending_review');

CREATE INDEX IF NOT EXISTS idx_recon_status ON public.stock_reconciliation_proposals(status);
CREATE INDEX IF NOT EXISTS idx_recon_risk ON public.stock_reconciliation_proposals(risk_level);
CREATE INDEX IF NOT EXISTS idx_recon_issue ON public.stock_reconciliation_proposals(issue_type);

DROP TRIGGER IF EXISTS trg_recon_set_updated_at ON public.stock_reconciliation_proposals;
CREATE TRIGGER trg_recon_set_updated_at
  BEFORE UPDATE ON public.stock_reconciliation_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.stock_reconciliation_proposals ENABLE ROW LEVEL SECURITY;

-- SELECT
DROP POLICY IF EXISTS "managers_select_proposals" ON public.stock_reconciliation_proposals;
CREATE POLICY "managers_select_proposals"
  ON public.stock_reconciliation_proposals FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'warehouse_supervisor')
  );

-- INSERT
DROP POLICY IF EXISTS "managers_insert_proposals" ON public.stock_reconciliation_proposals;
CREATE POLICY "managers_insert_proposals"
  ON public.stock_reconciliation_proposals FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'warehouse_supervisor')
  );

-- UPDATE
DROP POLICY IF EXISTS "managers_update_proposals" ON public.stock_reconciliation_proposals;
CREATE POLICY "managers_update_proposals"
  ON public.stock_reconciliation_proposals FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'warehouse_supervisor')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'warehouse_supervisor')
  );

-- NO DELETE POLICY. Proposals cannot be deleted.

-- ---------- helper: role guard ----------
CREATE OR REPLACE FUNCTION public._recon_assert_manager()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'warehouse_supervisor')
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege: manager role required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------- generator RPC ----------
CREATE OR REPLACE FUNCTION public.generate_stock_reconciliation_proposals()
RETURNS TABLE(
  total_processed int,
  inserted int,
  updated int,
  snapshot_batch_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_inserted int := 0;
  v_updated int := 0;
  v_total int := 0;
  v_actor uuid := auth.uid();
  r record;
  v_issue text;
  v_action text;
  v_risk text;
  v_reason text;
  v_adj numeric;
  v_target uuid;
  v_existing uuid;
BEGIN
  PERFORM public._recon_assert_manager();

  -- Snapshot
  INSERT INTO public.products_stock_snapshot_5d
    (product_id, legacy_stock_before, inventory_stock_before,
     main_stock_before, agouza_stock_before, snapped_at, snapped_by,
     batch_id, reason)
  SELECT
    v.product_id, v.legacy_stock, v.total_sales_inventory_stock,
    v.main_warehouse_stock, v.agouza_warehouse_stock, now(), v_actor,
    v_batch, 'pre_phase_5d_proposal_generation'
  FROM public.v_stock_reconciliation v;

  -- Classify + upsert proposals
  FOR r IN
    SELECT v.*,
           COALESCE(ar.demand_qty,0)   AS agouza_demand,
           COALESCE(ar.shortage,0)     AS agouza_shortage,
           COALESCE(ar.suggested_transfer,0) AS suggested_transfer,
           COALESCE(ar.main_sufficient,false) AS main_sufficient
    FROM public.v_stock_reconciliation v
    LEFT JOIN public.v_agouza_readiness ar ON ar.product_id = v.product_id
  LOOP
    v_total := v_total + 1;
    v_target := NULL;
    v_adj := NULL;

    -- Issue type
    IF r.barcode IS NULL OR length(trim(r.barcode)) = 0 THEN
      v_issue := 'missing_barcode';
      v_action := 'fix_barcode_first';
      v_reason := 'Product has no barcode; cannot be dispatched.';
      v_risk := CASE WHEN r.is_active THEN 'high' ELSE 'low' END;
    ELSIF NOT r.is_active THEN
      v_issue := 'inactive_product';
      v_action := CASE WHEN r.legacy_stock <> 0 OR r.total_sales_inventory_stock <> 0
                       THEN 'ignore_legacy_stock_later' ELSE 'no_action' END;
      v_reason := 'Product is inactive.';
      v_risk := 'low';
    ELSIF NOT r.has_main_row AND NOT r.has_agouza_row THEN
      v_issue := 'missing_inventory_row';
      v_action := 'manager_decision_required';
      v_reason := 'No sales inventory rows in Main or Agouza.';
      v_risk := 'high';
    ELSIF r.agouza_demand > 0 AND r.agouza_warehouse_stock = 0 THEN
      v_issue := 'agouza_zero_with_demand';
      v_action := 'transfer_main_to_agouza_later';
      v_target := 'a970d469-37df-40e1-b99f-a49195a3778e'::uuid;
      v_adj := r.suggested_transfer;
      v_reason := format('Agouza has 0 stock with demand %s; main has %s.',
                         r.agouza_demand, r.main_warehouse_stock);
      v_risk := CASE WHEN r.main_sufficient THEN 'medium' ELSE 'high' END;
    ELSIF r.difference > 0 THEN
      v_issue := 'legacy_gt_inventory';
      v_action := 'adjust_main_inventory_later';
      v_target := '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid;
      v_adj := r.difference;
      v_reason := format('Legacy stock %s exceeds sales inventory total %s.',
                         r.legacy_stock, r.total_sales_inventory_stock);
      v_risk := CASE
        WHEN abs(r.difference) >= 100 THEN 'critical'
        WHEN abs(r.difference) >= 20  THEN 'high'
        WHEN abs(r.difference) >= 5   THEN 'medium'
        ELSE 'low' END;
    ELSIF r.difference < 0 THEN
      v_issue := 'inventory_gt_legacy';
      v_action := 'ignore_legacy_stock_later';
      v_reason := format('Sales inventory total %s exceeds legacy stock %s (expected post Phase 3).',
                         r.total_sales_inventory_stock, r.legacy_stock);
      v_risk := CASE
        WHEN abs(r.difference) >= 100 THEN 'high'
        WHEN abs(r.difference) >= 20  THEN 'medium'
        ELSE 'low' END;
    ELSE
      v_issue := 'matched';
      v_action := 'no_action';
      v_reason := 'Legacy and sales inventory totals match.';
      v_risk := 'low';
    END IF;

    SELECT proposal_id INTO v_existing
    FROM public.stock_reconciliation_proposals
    WHERE product_id = r.product_id
      AND issue_type = v_issue
      AND status IN ('draft','pending_review')
    LIMIT 1;

    IF v_existing IS NULL THEN
      INSERT INTO public.stock_reconciliation_proposals (
        product_id, barcode, product_name,
        legacy_stock, main_warehouse_stock, agouza_warehouse_stock,
        total_sales_inventory_stock, difference,
        issue_type, proposed_action, proposed_adjustment_qty,
        target_warehouse_id, reason, risk_level,
        requires_manager_approval, status, created_by,
        audit_notes
      ) VALUES (
        r.product_id, r.barcode, r.product_name,
        r.legacy_stock, r.main_warehouse_stock, r.agouza_warehouse_stock,
        r.total_sales_inventory_stock, r.difference,
        v_issue, v_action, v_adj,
        v_target, v_reason, v_risk,
        true, 'draft', v_actor,
        jsonb_build_array(jsonb_build_object(
          'actor', v_actor, 'ts', now(),
          'from_status', NULL, 'to_status', 'draft',
          'note', 'generated by generate_stock_reconciliation_proposals',
          'batch_id', v_batch
        ))
      );
      v_inserted := v_inserted + 1;
    ELSE
      UPDATE public.stock_reconciliation_proposals
      SET barcode = r.barcode,
          product_name = r.product_name,
          legacy_stock = r.legacy_stock,
          main_warehouse_stock = r.main_warehouse_stock,
          agouza_warehouse_stock = r.agouza_warehouse_stock,
          total_sales_inventory_stock = r.total_sales_inventory_stock,
          difference = r.difference,
          proposed_action = v_action,
          proposed_adjustment_qty = v_adj,
          target_warehouse_id = v_target,
          reason = v_reason,
          risk_level = v_risk
      WHERE proposal_id = v_existing;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_total, v_inserted, v_updated, v_batch;
END;
$$;

-- ---------- proposal action RPCs ----------
CREATE OR REPLACE FUNCTION public._recon_transition(
  p_id uuid, p_from text[], p_to text, p_note text, p_actor_col text
) RETURNS public.stock_reconciliation_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_old text;
  v_row public.stock_reconciliation_proposals;
  v_sql text;
BEGIN
  PERFORM public._recon_assert_manager();

  SELECT status INTO v_old FROM public.stock_reconciliation_proposals WHERE proposal_id = p_id FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'proposal_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_old = ANY (p_from)) THEN
    RAISE EXCEPTION 'invalid_transition from % to %', v_old, p_to USING ERRCODE = 'P0001';
  END IF;

  v_sql := format(
    'UPDATE public.stock_reconciliation_proposals
        SET status = %L,
            %I = now(),
            %I = $1,
            audit_notes = audit_notes || $2::jsonb
      WHERE proposal_id = $3
      RETURNING *',
    p_to,
    CASE p_to
      WHEN 'pending_review' THEN 'reviewed_at'
      WHEN 'approved_for_future_execution' THEN 'approved_at'
      WHEN 'rejected' THEN 'rejected_at'
      WHEN 'dismissed' THEN 'dismissed_at'
      ELSE 'updated_at'
    END,
    p_actor_col
  );

  EXECUTE v_sql
    INTO v_row
    USING v_actor,
          jsonb_build_array(jsonb_build_object(
            'actor', v_actor, 'ts', now(),
            'from_status', v_old, 'to_status', p_to,
            'note', p_note
          )),
          p_id;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_proposal_for_review(p_id uuid, p_note text DEFAULT NULL)
RETURNS public.stock_reconciliation_proposals
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public._recon_transition(p_id, ARRAY['draft'], 'pending_review', p_note, 'reviewed_by'); $$;

CREATE OR REPLACE FUNCTION public.approve_proposal_for_future(p_id uuid, p_note text DEFAULT NULL)
RETURNS public.stock_reconciliation_proposals
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public._recon_transition(p_id, ARRAY['pending_review','draft'], 'approved_for_future_execution', p_note, 'approved_by'); $$;

CREATE OR REPLACE FUNCTION public.reject_proposal(p_id uuid, p_note text DEFAULT NULL)
RETURNS public.stock_reconciliation_proposals
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public._recon_transition(p_id, ARRAY['draft','pending_review','approved_for_future_execution'], 'rejected', p_note, 'rejected_by'); $$;

CREATE OR REPLACE FUNCTION public.dismiss_proposal(p_id uuid, p_reason text)
RETURNS public.stock_reconciliation_proposals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'dismiss_reason_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN public._recon_transition(p_id, ARRAY['draft','pending_review','approved_for_future_execution','rejected'], 'dismissed', p_reason, 'reviewed_by');
END;
$$;

CREATE OR REPLACE FUNCTION public.request_proposal_investigation(p_id uuid, p_note text)
RETURNS public.stock_reconciliation_proposals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.stock_reconciliation_proposals;
BEGIN
  PERFORM public._recon_assert_manager();
  UPDATE public.stock_reconciliation_proposals
  SET proposed_action = 'investigate',
      audit_notes = audit_notes || jsonb_build_array(jsonb_build_object(
        'actor', v_actor, 'ts', now(),
        'event', 'investigation_requested',
        'note', p_note
      ))
  WHERE proposal_id = p_id
  RETURNING * INTO v_row;
  IF v_row.proposal_id IS NULL THEN
    RAISE EXCEPTION 'proposal_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;
