-- Anon must not execute ledger, posting, or admin stock functions.
-- Supabase default privileges can grant EXECUTE to anon at CREATE time;
-- REVOKE FROM PUBLIC does not remove that explicit grant. This migration
-- revokes anon and PUBLIC, then restores authenticated and service_role only
-- when they could already execute the function. It does not change
-- ALTER DEFAULT PRIVILEGES.
--
-- post_meat_raw_movement is replaced so the packaging-history guard that
-- 20260927190000 dropped is back, before any stock write. The session-flag
-- reset stays.

CREATE OR REPLACE FUNCTION public.post_meat_raw_movement(
  p_item_id uuid,
  p_direction text,
  p_quantity numeric,
  p_unit_cost numeric,
  p_reason text,
  p_ref_table text,
  p_ref_id uuid,
  p_item_kind text DEFAULT NULL,
  p_effect text DEFAULT 'delta',
  p_target_stock numeric DEFAULT NULL,
  p_avg_cost numeric DEFAULT NULL,
  p_item_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.meat_factory_raw_items%ROWTYPE;
  v_before numeric;
  v_after numeric;
  v_dir text;
  v_qty numeric;
  v_existing uuid;
  v_kind text;
  v_name text;
BEGIN
  IF p_item_id IS NULL THEN RAISE EXCEPTION 'ITEM_REQUIRED'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF auth.uid() IS NOT NULL AND NOT (
    public.has_role(auth.uid(), 'general_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'meat_factory_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'warehouse_supervisor'::public.app_role)
    OR public.has_role(auth.uid(), 'production_manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: ترحيل خامات المصنع لأمين المخزن أو مدير المصنع أو المدير';
  END IF;

  SELECT * INTO v_item FROM public.meat_factory_raw_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود في خامات مصنع اللحوم'; END IF;
  IF v_item.kind = 'packaging' OR COALESCE(p_item_kind, '') = 'packaging' THEN
    RAISE EXCEPTION 'PACKAGING_HISTORY_READONLY: رصيد تغليف مصنع اللحوم للقراءة فقط. الشراء والخصم يتمان على مخزن التغليف.';
  END IF;
  v_before := COALESCE(v_item.current_stock, 0);
  v_kind := COALESCE(p_item_kind, v_item.kind, 'raw');
  v_name := COALESCE(p_item_name, v_item.name);

  IF COALESCE(p_effect, 'delta') = 'set' THEN
    v_after := COALESCE(p_target_stock, v_before);
    IF v_after < 0 THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK: الرصيد المستهدف سالب'; END IF;
    IF v_after = v_before THEN
      RETURN jsonb_build_object('status', 'no_change', 'stock_before', v_before, 'stock_after', v_after);
    END IF;
    v_dir := CASE WHEN v_after >= v_before THEN 'IN' ELSE 'OUT' END;
    v_qty := abs(v_after - v_before);
  ELSE
    v_dir := upper(btrim(COALESCE(p_direction, '')));
    IF v_dir NOT IN ('IN', 'OUT') THEN RAISE EXCEPTION 'INVALID_DIRECTION'; END IF;
    v_qty := abs(COALESCE(p_quantity, 0));
    IF v_qty = 0 THEN
      RETURN jsonb_build_object('status', 'no_change', 'stock_before', v_before, 'stock_after', v_before);
    END IF;
    IF v_dir = 'IN' THEN
      v_after := v_before + v_qty;
    ELSE
      IF v_before < v_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_before, v_qty;
      END IF;
      v_after := v_before - v_qty;
    END IF;
  END IF;

  IF p_ref_id IS NOT NULL AND p_ref_table IS NOT NULL THEN
    SELECT id INTO v_existing
      FROM public.meat_factory_inventory_moves
     WHERE ref_table = p_ref_table
       AND ref_id = p_ref_id
       AND item_id = p_item_id
       AND direction = v_dir
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_existing, 'status', 'already_posted', 'stock_before', v_before, 'stock_after', v_before);
    END IF;
  END IF;

  PERFORM set_config('app.meat_raw_stock_write', 'on', true);
  UPDATE public.meat_factory_raw_items
     SET current_stock = v_after,
         avg_cost = COALESCE(p_avg_cost, avg_cost),
         updated_at = now()
   WHERE id = p_item_id;

  INSERT INTO public.meat_factory_inventory_moves(
    item_kind, item_id, item_name, direction, quantity, unit_cost, reason,
    ref_table, ref_id, created_by, stock_before, stock_after, ledger_keyed
  ) VALUES (
    v_kind, p_item_id, v_name, v_dir, v_qty, COALESCE(p_unit_cost, 0), btrim(p_reason),
    p_ref_table, p_ref_id, auth.uid(), v_before, v_after, true
  );

  PERFORM set_config('app.meat_raw_stock_write', 'off', true);

  RETURN jsonb_build_object(
    'status', 'posted', 'stock_before', v_before, 'stock_after', v_after, 'direction', v_dir, 'quantity', v_qty
  );
EXCEPTION WHEN unique_violation THEN
  PERFORM set_config('app.meat_raw_stock_write', 'off', true);
  IF SQLERRM NOT ILIKE '%meat_raw_moves_source_uidx%'
     AND SQLERRM NOT ILIKE '%uq_meat_moves_%' THEN
    RAISE;
  END IF;
  RETURN jsonb_build_object('status', 'already_posted', 'stock_before', v_before, 'stock_after', v_before);
END;
$function$;

DO $revoke_anon_ledger$
DECLARE
  r record;
  v_name text;
  v_keep_auth boolean;
  v_keep_svc boolean;
  v_seen int := 0;
  v_names text[] := ARRAY[
    'close_legacy_doc_by_stocktake',
    'close_legacy_docs_by_stocktake',
    'post_inventory_movement',
    'post_meat_raw_movement',
    'post_named_stock',
    'post_manual_inventory_movement',
    'set_inventory_item_stock',
    'reverse_posted_inventory_movement',
    'post_purchase_in_packs',
    'post_waste_movement',
    'post_outlet_sale',
    'post_production_movement',
    'post_packaging_consumption',
    'post_packaging_warehouse_move',
    'post_outlet_sales_statement',
    'reverse_outlet_sales_statement',
    'save_outlet_sales_statement',
    'inv_post_movement',
    'inv_transfer',
    'ledger_apply_card_stock',
    '_dispatch_order_stock_core',
    '_return_order_dispatched_stock',
    'commit_agouza_stock_on_delivery',
    'adjust_main_warehouse_stock',
    'return_order_stock',
    'retry_failed_order_dispatches',
    'approve_stocktaking_session',
    'submit_stock_adjustment',
    'approve_warehouse_opening_balance',
    'upsert_stocktaking_line',
    'create_and_send_transfer',
    'confirm_transfer_receipt',
    'merge_duplicate_inventory_cards',
    'merge_inventory_items',
    'mr_reconcile_negative_stock',
    'reverse_receipt_approval',
    'receive_meat_production_transfer',
    'receive_mf_transfer',
    'receive_slaughter_output',
    'receive_slaughter_output_to_meat_factory',
    'approve_meat_manufacturing_invoice',
    'cancel_meat_manufacturing_invoice',
    'apply_meat_stocktake',
    'approve_meat_manufacturing',
    'approve_meat_purchase',
    'meat_factory_adjust_stock',
    'record_courier_return',
    'sync_main_stock_to_sublocations',
    'approve_meat_factory_batch',
    'approve_meat_sale',
    'approve_meat_sales_return',
    'cancel_meat_sales_return',
    'post_mf_raw_purchase',
    'post_mf_pack_purchase',
    'post_mf_manufacturing',
    'post_mf_sale',
    'post_mf_return',
    'post_mf_transfer',
    'reject_mf_transfer',
    'ensure_packaging_warehouse',
    'resolve_packaging_card'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'anon, authenticated, and service_role must exist before revoking ledger execute';
  END IF;

  FOREACH v_name IN ARRAY v_names LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_name
    ) THEN
      RAISE EXCEPTION 'missing ledger function %', v_name;
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (v_names)
  LOOP
    v_keep_auth := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    v_keep_svc := has_function_privilege('service_role', r.oid, 'EXECUTE');
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.oid::regprocedure);
    IF v_keep_auth THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.oid::regprocedure);
    END IF;
    IF v_keep_svc THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
    END IF;
    v_seen := v_seen + 1;
  END LOOP;

  IF v_seen < cardinality(v_names) THEN
    RAISE EXCEPTION 'revoke visited % functions, expected at least %', v_seen, cardinality(v_names);
  END IF;
END
$revoke_anon_ledger$;
