
-- 1. Fix finalize_slaughter_batch: remove write to generated column actual_yield_pct
CREATE OR REPLACE FUNCTION public.finalize_slaughter_batch(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch public.slaughter_batches%ROWTYPE;
  v_old   public.slaughter_batches%ROWTYPE;
  v_meat numeric := 0;
  v_total_purchase numeric := 0;
  v_cost_per_kg numeric := 0;
  v_transfers int := 0;
  v_yield_pct numeric := 0;
BEGIN
  SELECT * INTO v_batch FROM public.slaughter_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  v_old := v_batch;

  SELECT COALESCE(SUM(actual_weight_kg),0) INTO v_meat
  FROM public.slaughter_batch_outputs WHERE batch_id = p_batch_id;

  IF v_batch.live_receipt_id IS NOT NULL THEN
    SELECT COALESCE(total_cost,0) + COALESCE((
      SELECT SUM(feed_cost) FROM public.slaughter_live_birds WHERE receipt_id = v_batch.live_receipt_id
    ),0) INTO v_total_purchase
    FROM public.slaughter_live_receipts WHERE id = v_batch.live_receipt_id;
  END IF;

  IF v_meat > 0 THEN v_cost_per_kg := v_total_purchase / v_meat; END IF;
  IF v_batch.total_live_weight_kg > 0 THEN
    v_yield_pct := (v_meat / v_batch.total_live_weight_kg) * 100;
  END IF;

  -- NOTE: actual_yield_pct is a GENERATED column — do NOT write to it
  UPDATE public.slaughter_batches
  SET total_meat_kg = v_meat,
      cost_per_kg_meat = v_cost_per_kg,
      status = 'completed',
      end_time = COALESCE(end_time, CURRENT_TIME)
  WHERE id = p_batch_id;

  UPDATE public.slaughter_batch_outputs
  SET unit_cost = v_cost_per_kg
  WHERE batch_id = p_batch_id;

  INSERT INTO public.slaughter_branch_transfers (batch_id, output_id, branch_id, cut_name_ar, weight_kg, unit_price)
  SELECT o.batch_id, o.id, o.branch_id, o.cut_name_ar, o.actual_weight_kg, o.unit_price
  FROM public.slaughter_batch_outputs o
  WHERE o.batch_id = p_batch_id
    AND o.branch_id IS NOT NULL
    AND o.actual_weight_kg > 0
    AND NOT EXISTS (SELECT 1 FROM public.slaughter_branch_transfers t WHERE t.output_id = o.id);
  GET DIAGNOSTICS v_transfers = ROW_COUNT;

  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, old_value, new_value, notes)
  VALUES
    ('finalize_batch', 'batch', p_batch_id, p_batch_id, auth.uid(),
     jsonb_build_object(
       'status', v_old.status,
       'total_meat_kg', v_old.total_meat_kg,
       'actual_yield_pct', v_old.actual_yield_pct,
       'cost_per_kg_meat', v_old.cost_per_kg_meat
     ),
     jsonb_build_object(
       'status', 'completed',
       'total_meat_kg', v_meat,
       'actual_yield_pct', v_yield_pct,
       'cost_per_kg_meat', v_cost_per_kg,
       'total_purchase_cost', v_total_purchase,
       'transfers_created', v_transfers
     ),
     format('Finalized batch %s — yield %.1f%%, %s transfers', v_batch.batch_number, v_yield_pct, v_transfers));

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'total_meat_kg', v_meat,
    'total_purchase_cost', v_total_purchase,
    'cost_per_kg_meat', v_cost_per_kg,
    'actual_yield_pct', v_yield_pct,
    'transfers_created', v_transfers
  );
END;
$function$;

-- 2. Rebuild shipments view on top of REAL receipts (slaughter_batch_outputs.received_*)
--    One row per (batch, destination warehouse, minute-bucket of received_at)
DROP VIEW IF EXISTS public.v_slaughter_transfer_shipments;

CREATE VIEW public.v_slaughter_transfer_shipments AS
WITH grouped AS (
  SELECT
    o.batch_id,
    o.received_warehouse_id,
    date_trunc('minute', o.received_at) AS shipment_bucket,
    MIN(o.received_at) AS transferred_at,
    MAX(o.received_at) AS received_at,
    SUM(o.actual_weight_kg) AS total_kg,
    SUM(o.actual_weight_kg * o.unit_price) AS total_value,
    COUNT(*)::int AS items_count,
    BOOL_AND(o.quality_status = 'rejected') AS all_rejected,
    BOOL_OR(o.quality_status = 'rejected') AS any_rejected
  FROM public.slaughter_batch_outputs o
  WHERE o.received_status = 'received'
    AND o.received_warehouse_id IS NOT NULL
    AND o.received_at IS NOT NULL
  GROUP BY o.batch_id, o.received_warehouse_id, date_trunc('minute', o.received_at)
)
SELECT
  ('SH-' || to_char(g.shipment_bucket, 'YYYYMMDD-HH24MI') || '-' || substr(g.received_warehouse_id::text, 1, 4)) AS shipment_no,
  g.batch_id,
  b.batch_number,
  b.slaughter_date,
  g.received_warehouse_id AS branch_id,
  g.transferred_at,
  g.transferred_at AS created_at,
  g.received_at,
  g.total_kg,
  g.total_value,
  g.items_count,
  CASE
    WHEN g.all_rejected THEN 'rejected'
    WHEN g.any_rejected THEN 'partially_rejected'
    ELSE 'received'
  END AS shipment_status,
  b.butcher_1_id,
  b.butcher_2_id,
  b.butcher_3_id
FROM grouped g
JOIN public.slaughter_batches b ON b.id = g.batch_id;

GRANT SELECT ON public.v_slaughter_transfer_shipments TO authenticated;
GRANT SELECT ON public.v_slaughter_transfer_shipments TO anon;

-- 3. Cleanup TEST data from E2E verification
DELETE FROM public.inventory_movements
  WHERE reference LIKE 'استلام من دفعة ذبح TEST-SLAUGHTER-TRANSFER-%';
DELETE FROM public.inventory_items
  WHERE name IN ('TEST-موزة','TEST-فيليه','TEST-استيك');
DELETE FROM public.slaughter_batches
  WHERE batch_number LIKE 'TEST-SLAUGHTER-TRANSFER-%';
DELETE FROM public.slaughter_live_receipts
  WHERE receipt_number LIKE 'TEST-RCPT-%';
