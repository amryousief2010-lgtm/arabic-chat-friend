-- Zodex auto-link + review queue (PR 1). ADDITIVE ONLY. Not applied until Amr approves.
-- Rollback: see bottom of file.

-- 1) Amount difference flag on orders (coceg total is NEVER overwritten by Zodex).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS zodex_cod_amount numeric,
  ADD COLUMN IF NOT EXISTS zodex_amount_diff numeric;
COMMENT ON COLUMN public.orders.zodex_cod_amount IS 'Last COD amount read from Zodex. Informational; orders.total is not changed.';

-- 2) Unified review queue: one open row per waybill.
CREATE TABLE IF NOT EXISTS public.zodex_link_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('AUTO','REVIEW','BLOCKED','NO_ORDER','SUSPECT')),
  suggested_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  score numeric,
  amount_diff numeric,
  zodex_cod numeric,
  zodex_status text,
  shipment_date timestamptz,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,     -- plain-Arabic reasons
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{order_id, order_number, score, evidence[]}]
  engine_version text NOT NULL,
  run_id uuid,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','auto_linked','confirmed','rejected','undone','superseded')),
  linked_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS zodex_link_queue_open_bill_uidx ON public.zodex_link_queue (bill_no) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS zodex_link_queue_tier_state_idx ON public.zodex_link_queue (state, tier, created_at DESC);
CREATE INDEX IF NOT EXISTS zodex_link_queue_order_idx ON public.zodex_link_queue (suggested_order_id);

ALTER TABLE public.zodex_link_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zodex_link_queue_read ON public.zodex_link_queue;
CREATE POLICY zodex_link_queue_read ON public.zodex_link_queue FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY[
    'general_manager','executive_manager','sales_manager','marketing_sales_manager',
    'marketing_sales_viewer','warehouse_supervisor','agouza_warehouse_keeper','financial_manager','accountant'
  ]::public.app_role[]));
-- No INSERT/UPDATE/DELETE policies: writes only via service role (sync) and the RPCs below.

-- 3) Who may decide (role-based, no hard-coded user ids).
CREATE OR REPLACE FUNCTION public.zodex_can_review() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','marketing_sales_manager']::public.app_role[]);
$$;

-- 4) Confirm / reject / choose another candidate. Atomic, audited, idempotent.
CREATE OR REPLACE FUNCTION public.zodex_review_decide(p_queue_id uuid, p_action text, p_order_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.zodex_link_queue; v_order uuid; v_prev text;
BEGIN
  IF NOT public.zodex_can_review() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_action NOT IN ('confirm','reject') THEN RAISE EXCEPTION 'BAD_ACTION'; END IF;
  SELECT * INTO q FROM public.zodex_link_queue WHERE id = p_queue_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF q.state <> 'open' THEN RETURN jsonb_build_object('ok', true, 'already', q.state); END IF;

  IF p_action = 'reject' THEN
    UPDATE public.zodex_link_queue SET state='rejected', decided_by=auth.uid(), decided_at=now(), decision_note=p_note, updated_at=now() WHERE id=q.id;
    RETURN jsonb_build_object('ok', true, 'state', 'rejected');
  END IF;

  v_order := COALESCE(p_order_id, q.suggested_order_id);
  IF v_order IS NULL THEN RAISE EXCEPTION 'NO_ORDER_SELECTED'; END IF;
  IF p_order_id IS NOT NULL AND NOT (q.candidates @> jsonb_build_array(jsonb_build_object('order_id', p_order_id::text))) THEN
    RAISE EXCEPTION 'ORDER_NOT_A_CANDIDATE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE shipping_bill_no = q.bill_no AND id <> v_order) THEN
    RAISE EXCEPTION 'BILL_ON_OTHER_ORDER';
  END IF;
  SELECT shipping_bill_no INTO v_prev FROM public.orders WHERE id = v_order FOR UPDATE;
  IF v_prev IS NOT NULL AND v_prev <> q.bill_no THEN RAISE EXCEPTION 'ORDER_HAS_OTHER_BILL'; END IF;

  UPDATE public.orders
     SET shipping_bill_no = q.bill_no, zodex_cod_amount = q.zodex_cod,
         zodex_amount_diff = CASE WHEN q.zodex_cod IS NULL THEN NULL ELSE q.zodex_cod - total END
   WHERE id = v_order;            -- orders.total untouched by design
  INSERT INTO public.zodex_bill_link_audit (bill_no, order_id, linked_by, match_score, match_reason, previous_bill_no)
  VALUES (q.bill_no, v_order, auth.uid(), q.score, 'review_confirm:' || q.engine_version, v_prev);
  UPDATE public.zodex_link_queue SET state='confirmed', linked_order_id=v_order, decided_by=auth.uid(), decided_at=now(), decision_note=p_note, updated_at=now() WHERE id=q.id;
  RETURN jsonb_build_object('ok', true, 'state', 'confirmed', 'order_id', v_order);
END $$;

-- 5) Bulk-confirm (safe tier only, i.e. AUTO rows still open). Returns counts.
CREATE OR REPLACE FUNCTION public.zodex_review_bulk_confirm(p_queue_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; ok int := 0; failed int := 0; errs jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.zodex_can_review() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  FOREACH v_id IN ARRAY p_queue_ids LOOP
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.zodex_link_queue WHERE id=v_id AND tier='AUTO' AND state='open') THEN
        RAISE EXCEPTION 'NOT_SAFE_TIER';
      END IF;
      PERFORM public.zodex_review_decide(v_id, 'confirm', NULL, 'bulk');
      ok := ok + 1;
    EXCEPTION WHEN OTHERS THEN
      failed := failed + 1; errs := errs || jsonb_build_object('id', v_id, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('confirmed', ok, 'failed', failed, 'errors', errs);
END $$;

-- 6) One-click undo of an auto-link or a confirmation.
CREATE OR REPLACE FUNCTION public.zodex_link_undo(p_queue_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.zodex_link_queue;
BEGIN
  IF NOT public.zodex_can_review() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO q FROM public.zodex_link_queue WHERE id = p_queue_id FOR UPDATE;
  IF q.id IS NULL OR q.state NOT IN ('auto_linked','confirmed') THEN RAISE EXCEPTION 'NOT_UNDOABLE'; END IF;
  UPDATE public.orders SET shipping_bill_no = NULL, zodex_cod_amount = NULL, zodex_amount_diff = NULL
   WHERE id = q.linked_order_id AND shipping_bill_no = q.bill_no;
  INSERT INTO public.zodex_bill_link_audit (bill_no, order_id, linked_by, match_reason, previous_bill_no)
  VALUES (q.bill_no, q.linked_order_id, auth.uid(), 'undo:' || q.engine_version, q.bill_no);
  UPDATE public.zodex_link_queue SET state='undone', decided_by=auth.uid(), decided_at=now(), decision_note=p_note, updated_at=now() WHERE id=q.id;
  -- Re-open for review so the waybill is never silently lost.
  INSERT INTO public.zodex_link_queue (bill_no, tier, suggested_order_id, score, amount_diff, zodex_cod, zodex_status, shipment_date, reasons, candidates, engine_version, run_id)
  VALUES (q.bill_no, 'REVIEW', q.suggested_order_id, q.score, q.amount_diff, q.zodex_cod, q.zodex_status, q.shipment_date,
          q.reasons || '["أُعيد للمراجعة بعد التراجع عن الربط"]'::jsonb, q.candidates, q.engine_version, q.run_id);
  RETURN jsonb_build_object('ok', true);
END $$;

-- 7) Health view for the status panel (no PII).
CREATE OR REPLACE VIEW public.zodex_sync_health WITH (security_invoker = true) AS
SELECT
  (SELECT max(started_at) FROM public.zodex_sync_runs WHERE status IN ('success','completed_with_errors')) AS last_data_at,
  (SELECT max(started_at) FROM public.zodex_sync_runs WHERE status = 'success') AS last_full_success_at,
  (SELECT max(started_at) FROM public.zodex_sync_runs WHERE status = 'failed' AND error_message ILIKE '%login%') AS last_login_failure_at,
  (SELECT count(*) FROM public.zodex_sync_runs WHERE status = 'failed' AND started_at > now() - interval '24 hours') AS failures_24h,
  (SELECT count(*) FROM public.zodex_sync_runs WHERE status = 'running' AND started_at < now() - interval '15 minutes') AS hung_runs,
  (SELECT status FROM public.zodex_sync_runs ORDER BY started_at DESC LIMIT 1) AS last_status,
  (SELECT left(error_message, 200) FROM public.zodex_sync_runs ORDER BY started_at DESC LIMIT 1) AS last_error,
  (SELECT count(*) FROM public.zodex_link_queue WHERE state='open' AND tier='AUTO') AS open_auto,
  (SELECT count(*) FROM public.zodex_link_queue WHERE state='open' AND tier='REVIEW') AS open_review,
  (SELECT count(*) FROM public.zodex_link_queue WHERE state='open' AND tier='BLOCKED') AS open_blocked,
  (SELECT count(*) FROM public.zodex_link_queue WHERE state='open' AND tier='NO_ORDER') AS open_no_order,
  (SELECT count(*) FROM public.zodex_link_queue WHERE state='open' AND tier='SUSPECT') AS open_suspect;

REVOKE ALL ON FUNCTION public.zodex_review_decide(uuid,text,uuid,text), public.zodex_review_bulk_confirm(uuid[]),
  public.zodex_link_undo(uuid,text), public.zodex_can_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zodex_review_decide(uuid,text,uuid,text), public.zodex_review_bulk_confirm(uuid[]),
  public.zodex_link_undo(uuid,text), public.zodex_can_review() TO authenticated;
GRANT SELECT ON public.zodex_sync_health TO authenticated;

-- ROLLBACK (manual, only if Amr asks):
-- DROP VIEW IF EXISTS public.zodex_sync_health;
-- DROP FUNCTION IF EXISTS public.zodex_link_undo(uuid,text), public.zodex_review_bulk_confirm(uuid[]),
--   public.zodex_review_decide(uuid,text,uuid,text), public.zodex_can_review();
-- DROP TABLE IF EXISTS public.zodex_link_queue;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS zodex_amount_diff, DROP COLUMN IF EXISTS zodex_cod_amount;

-- ===== zx-match-2 additions (27/10): sheet source, reverse matching, guarded bulk status plan =====
ALTER TABLE public.zodex_link_queue ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'SYNC'
  CHECK (origin IN ('SYNC','SHEET','REVERSE','SWEEP'));

-- Waybills seen (sync or delivery sheet) with no order yet; consumed by reverse matching on order insert + periodic sweep.
CREATE TABLE IF NOT EXISTS public.zodex_unmatched_bills (
  bill_no text PRIMARY KEY,
  phones_last9 text[] NOT NULL DEFAULT '{}',
  cod numeric, shipment_date timestamptz, zodex_status text,
  first_seen_at timestamptz NOT NULL DEFAULT now(), last_tried_at timestamptz,
  resolved_order_id uuid, resolved_at timestamptz
);
ALTER TABLE public.zodex_unmatched_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY zub_read ON public.zodex_unmatched_bills FOR SELECT USING (public.zodex_can_review());
CREATE INDEX IF NOT EXISTS zub_open_idx ON public.zodex_unmatched_bills USING gin (phones_last9) WHERE resolved_order_id IS NULL;

-- Bulk return/cancel plan: proposed rows reviewed then applied in one batch; each row keeps from_status for undo.
CREATE TABLE IF NOT EXISTS public.zodex_status_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id), bill_no text NOT NULL,
  from_status text NOT NULL, to_status text, zodex_status text, origin text NOT NULL DEFAULT 'SYNC',
  needs_review boolean NOT NULL DEFAULT false, applied_at timestamptz, applied_by uuid, undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zodex_status_plan ENABLE ROW LEVEL SECURITY;
CREATE POLICY zsp_read ON public.zodex_status_plan FOR SELECT USING (public.zodex_can_review());

CREATE OR REPLACE FUNCTION public.zodex_status_apply_batch(p_batch uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT public.zodex_can_review() THEN RAISE EXCEPTION 'not allowed'; END IF;
  WITH u AS (
    UPDATE public.orders o SET status = p.to_status, updated_at = now()
    FROM public.zodex_status_plan p
    WHERE p.batch_id = p_batch AND p.order_id = o.id AND p.applied_at IS NULL AND NOT p.needs_review
      AND p.to_status IS NOT NULL AND o.status = p.from_status   -- guard: unchanged since planning
    RETURNING p.id)
  UPDATE public.zodex_status_plan SET applied_at = now(), applied_by = auth.uid() WHERE id IN (SELECT id FROM u);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.zodex_status_undo_batch(p_batch uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT public.zodex_can_review() THEN RAISE EXCEPTION 'not allowed'; END IF;
  WITH u AS (
    UPDATE public.orders o SET status = p.from_status, updated_at = now()
    FROM public.zodex_status_plan p
    WHERE p.batch_id = p_batch AND p.order_id = o.id AND p.applied_at IS NOT NULL AND p.undone_at IS NULL
      AND o.status = p.to_status
    RETURNING p.id)
  UPDATE public.zodex_status_plan SET undone_at = now() WHERE id IN (SELECT id FROM u);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
-- Reverse-match trigger on orders INSERT is deliberately NOT here: it calls the edge engine via the sweep
-- (every 15 min) in PR 2 to keep this migration free of side effects on order creation.
-- Rollback (additions): DROP FUNCTION public.zodex_status_undo_batch(uuid), public.zodex_status_apply_batch(uuid);
--   DROP TABLE public.zodex_status_plan, public.zodex_unmatched_bills; ALTER TABLE public.zodex_link_queue DROP COLUMN origin;
