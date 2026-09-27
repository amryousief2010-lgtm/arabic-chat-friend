-- Reconciliation, duplicate-card report (not applied), and the Egex staging hook.
-- The merge function does not run here. The owner approves, then calls it with p_apply true.
-- Baseline: approved stocktake at or after 2026-09-30 00:00 Africa/Cairo.
-- Movements before that baseline, and legacy rows without stock_before/stock_after, are excluded.

CREATE TABLE IF NOT EXISTS public.inventory_card_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL,
  product_id uuid,
  canonical_id uuid NOT NULL,
  duplicate_id uuid NOT NULL,
  canonical_stock_before numeric,
  duplicate_stock numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.inventory_card_merge_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_card_merge_log_read ON public.inventory_card_merge_log;
CREATE POLICY inventory_card_merge_log_read ON public.inventory_card_merge_log
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'warehouse_supervisor'::public.app_role)
  );
DROP POLICY IF EXISTS inventory_card_merge_log_service ON public.inventory_card_merge_log;
CREATE POLICY inventory_card_merge_log_service ON public.inventory_card_merge_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.inventory_card_merge_log TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.report_duplicate_inventory_cards()
RETURNS TABLE(
  warehouse_id uuid,
  warehouse_name text,
  product_id uuid,
  product_name text,
  card_count integer,
  card_ids uuid[],
  stocks numeric[],
  canonical_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT i.warehouse_id,
         w.name,
         i.product_id,
         p.name,
         count(*)::int,
         array_agg(i.id ORDER BY i.id),
         array_agg(i.stock ORDER BY i.id),
         (array_agg(i.id ORDER BY i.id))[1]
    FROM public.inventory_items i
    LEFT JOIN public.warehouses w ON w.id = i.warehouse_id
    LEFT JOIN public.products p ON p.id = i.product_id
   WHERE i.product_id IS NOT NULL
   GROUP BY i.warehouse_id, w.name, i.product_id, p.name
  HAVING count(*) > 1
   ORDER BY w.name, p.name;
$$;

REVOKE ALL ON FUNCTION public.report_duplicate_inventory_cards() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_duplicate_inventory_cards() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.merge_duplicate_inventory_cards(p_apply boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g record;
  v_dup uuid;
  v_dup_stock numeric;
  v_can_stock numeric;
  v_n int := 0;
  v_uid uuid := auth.uid();
BEGIN
  IF COALESCE(p_apply, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'applied', false,
      'message', 'تقرير فقط. الدمج لا يُنفَّذ إلا بعد موافقة المالك بتمرير p_apply=true',
      'duplicates', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM public.report_duplicate_inventory_cards() r), '[]'::jsonb)
    );
  END IF;

  IF v_uid IS NOT NULL AND NOT (
    public.has_role(v_uid, 'general_manager'::public.app_role)
    OR public.has_role(v_uid, 'executive_manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: دمج البطاقات للمدير العام أو المدير التنفيذي';
  END IF;

  PERFORM set_config('app.inventory_ledger_relink', 'on', true);
  PERFORM set_config('app.inventory_stock_write', 'on', true);

  FOR g IN SELECT * FROM public.report_duplicate_inventory_cards() LOOP
    SELECT stock INTO v_can_stock FROM public.inventory_items WHERE id = g.canonical_id FOR UPDATE;
    FOREACH v_dup IN ARRAY g.card_ids LOOP
      IF v_dup = g.canonical_id THEN CONTINUE; END IF;
      SELECT stock INTO v_dup_stock FROM public.inventory_items WHERE id = v_dup FOR UPDATE;
      UPDATE public.inventory_movements SET item_id = g.canonical_id WHERE item_id = v_dup;
      UPDATE public.inventory_items
         SET stock = COALESCE(stock, 0) + COALESCE(v_dup_stock, 0),
             last_movement_date = now()
       WHERE id = g.canonical_id;
      UPDATE public.inventory_items
         SET stock = 0,
             is_active = false,
             product_id = NULL,
             notes = COALESCE(notes, '') || ' [دُمجت في ' || g.canonical_id::text || ']',
             updated_at = now()
       WHERE id = v_dup;
      INSERT INTO public.inventory_card_merge_log(
        warehouse_id, product_id, canonical_id, duplicate_id, canonical_stock_before, duplicate_stock, created_by
      ) VALUES (
        g.warehouse_id, g.product_id, g.canonical_id, v_dup, v_can_stock, v_dup_stock, v_uid
      );
      v_n := v_n + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('applied', true, 'merged_cards', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_duplicate_inventory_cards(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_inventory_cards(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inventory_reconciliation_check(p_in_transit_days integer DEFAULT 3)
RETURNS TABLE(
  check_code text,
  warehouse_id uuid,
  item_id uuid,
  source_ref text,
  detail text,
  expected_qty numeric,
  actual_qty numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NOT NULL AND NOT (
    public.has_role(v_uid, 'general_manager'::public.app_role)
    OR public.has_role(v_uid, 'executive_manager'::public.app_role)
    OR public.has_role(v_uid, 'warehouse_supervisor'::public.app_role)
    OR public.has_role(v_uid, 'accountant'::public.app_role)
    OR public.has_role(v_uid, 'financial_manager'::public.app_role)
    OR public.has_role(v_uid, 'cost_accountant'::public.app_role)
    OR public.has_role(v_uid, 'agouza_warehouse_keeper'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  RETURN QUERY
  WITH baselines AS (
    SELECT DISTINCT ON (s.warehouse_id)
           s.warehouse_id, s.id AS session_id, s.approved_at
      FROM public.stocktaking_sessions s
     WHERE s.status = 'approved'
       AND s.approved_at >= timestamptz '2026-09-30 00:00:00 Africa/Cairo'
     ORDER BY s.warehouse_id, s.approved_at DESC
  ),
  baseline_qty AS (
    SELECT b.warehouse_id, l.item_id, b.approved_at, l.actual_qty AS qty
      FROM baselines b
      JOIN public.stocktaking_lines l ON l.session_id = b.session_id
  ),
  movement_sum AS (
    SELECT m.item_id,
           SUM(m.stock_after - m.stock_before) AS delta
      FROM public.inventory_movements m
      JOIN baseline_qty b ON b.item_id = m.item_id
     WHERE m.performed_at > b.approved_at
       AND COALESCE(m.approval_status, 'posted') = 'posted'
       AND m.stock_before IS NOT NULL
       AND m.stock_after IS NOT NULL
       AND COALESCE(m.source_type, '') IS DISTINCT FROM 'stocktake'
     GROUP BY m.item_id
  )
  SELECT 'stock_mismatch'::text,
         i.warehouse_id,
         i.id,
         NULL::text,
         'الرصيد لا يساوي أساس الجرد + الحركات بعده'::text,
         (b.qty + COALESCE(ms.delta, 0)),
         i.stock
    FROM baseline_qty b
    JOIN public.inventory_items i ON i.id = b.item_id
    LEFT JOIN movement_sum ms ON ms.item_id = i.id
   WHERE i.stock IS DISTINCT FROM (b.qty + COALESCE(ms.delta, 0));

  RETURN QUERY
  SELECT 'no_baseline'::text, w.id, NULL::uuid, NULL::text,
         'لا يوجد جرد معتمد في أو بعد 30 سبتمبر 2026 — المطابقة تبدأ من ذلك الجرد'::text,
         NULL::numeric, NULL::numeric
    FROM public.warehouses w
   WHERE NOT EXISTS (
     SELECT 1 FROM public.stocktaking_sessions s
      WHERE s.warehouse_id = w.id
        AND s.status = 'approved'
        AND s.approved_at >= timestamptz '2026-09-30 00:00:00 Africa/Cairo'
   );

  RETURN QUERY
  SELECT 'delivered_without_dispatch'::text, o.source_warehouse_id, NULL::uuid, o.order_number,
         COALESCE(o.stock_status, 'بدون حالة مخزون'),
         NULL::numeric, NULL::numeric
    FROM public.orders o
   WHERE o.status = 'delivered'
     AND COALESCE(o.stock_status, '') NOT IN ('dispatched', 'skipped_period_lock')
     AND o.source_warehouse_id IS NOT NULL
     AND public._order_auto_dispatch_allowed(o.source_warehouse_id, o.delivered_at);

  RETURN QUERY
  SELECT 'dispatch_without_delivered_order'::text, m.warehouse_id, m.item_id,
         COALESCE(m.reference, m.reference_id),
         'صرف مبيعات والأوردر ليس مسلَّماً',
         m.quantity, NULL::numeric
    FROM public.inventory_movements m
    JOIN public.orders o ON o.id::text = m.reference_id
   WHERE m.movement_type = 'sales_dispatch'
     AND COALESCE(m.approval_status, 'posted') = 'posted'
     AND o.status IS DISTINCT FROM 'delivered'
     AND o.status IS DISTINCT FROM 'returned'
     AND o.status IS DISTINCT FROM 'cancelled';

  RETURN QUERY
  SELECT 'duplicate_source_key'::text, NULL::uuid, NULL::uuid,
         d.source_type || ':' || d.source_id::text || ':' || d.source_line_id,
         'مفتاح مستند مكرر',
         d.n::numeric, NULL::numeric
    FROM (
      SELECT source_type, source_id, source_line_id, count(*) AS n
        FROM public.inventory_movements
       WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND source_line_id IS NOT NULL
         AND COALESCE(approval_status, 'posted') = 'posted'
       GROUP BY 1, 2, 3
      HAVING count(*) > 1
    ) d;

  RETURN QUERY
  SELECT 'negative_stock'::text, i.warehouse_id, i.id, i.name,
         'رصيد سالب', NULL::numeric, i.stock
    FROM public.inventory_items i
   WHERE i.stock < 0 AND COALESCE(i.is_active, true);

  RETURN QUERY
  SELECT 'movement_without_snapshot'::text, m.warehouse_id, m.item_id, m.id::text,
         'حركة بعد أساس الجرد بدون لقطة قبل/بعد',
         NULL::numeric, m.quantity
    FROM public.inventory_movements m
    JOIN public.stocktaking_sessions s
      ON s.warehouse_id = m.warehouse_id
     AND s.status = 'approved'
     AND s.approved_at >= timestamptz '2026-09-30 00:00:00 Africa/Cairo'
     AND m.performed_at > s.approved_at
   WHERE COALESCE(m.approval_status, 'posted') = 'posted'
     AND (m.stock_before IS NULL OR m.stock_after IS NULL);

  RETURN QUERY
  SELECT 'transfer_in_transit'::text, t.source_warehouse_id, NULL::uuid, t.transfer_no,
         'تحويل لم يُستلم منذ ' || p_in_transit_days::text || ' أيام — الحالة ' || t.status,
         NULL::numeric, NULL::numeric
    FROM public.warehouse_transfers t
   WHERE t.status NOT IN ('received', 'cancelled')
     AND COALESCE(t.sent_at, t.created_at) < now() - make_interval(days => GREATEST(p_in_transit_days, 1));
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_reconciliation_check(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_reconciliation_check(integer) TO authenticated, service_role;

-- Read-only Egex comparison. The staging table is not in this repository.
-- When it is absent the function says so instead of inventing quantities.
CREATE OR REPLACE FUNCTION public.inventory_egex_staging_compare()
RETURNS TABLE(
  store_key text,
  item_key text,
  app_qty numeric,
  egex_qty numeric,
  note text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sql text;
  v_store text;
  v_item text;
  v_qty text;
BEGIN
  IF v_uid IS NOT NULL AND NOT (
    public.has_role(v_uid, 'general_manager'::public.app_role)
    OR public.has_role(v_uid, 'executive_manager'::public.app_role)
    OR public.has_role(v_uid, 'warehouse_supervisor'::public.app_role)
    OR public.has_role(v_uid, 'accountant'::public.app_role)
    OR public.has_role(v_uid, 'financial_manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF to_regclass('public.egex_sync_staging') IS NULL THEN
    store_key := NULL;
    item_key := NULL;
    app_qty := NULL;
    egex_qty := NULL;
    note := 'جدول egex_sync_staging غير موجود. المقارنة تُفعَّل عند وجود الجدول وحتى إيقاف إيجكس.';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT c.column_name INTO v_store
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'egex_sync_staging'
     AND c.column_name IN ('store_name', 'store', 'warehouse_name', 'branch_name')
   ORDER BY c.column_name LIMIT 1;
  SELECT c.column_name INTO v_item
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'egex_sync_staging'
     AND c.column_name IN ('item_name', 'product_name', 'name', 'sku')
   ORDER BY c.column_name LIMIT 1;
  SELECT c.column_name INTO v_qty
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'egex_sync_staging'
     AND c.column_name IN ('qty', 'quantity', 'stock', 'balance')
   ORDER BY c.column_name LIMIT 1;

  IF v_store IS NULL OR v_item IS NULL OR v_qty IS NULL THEN
    store_key := NULL;
    item_key := NULL;
    app_qty := NULL;
    egex_qty := NULL;
    note := 'جدول egex_sync_staging موجود لكن أعمدة المخزن/الصنف/الكمية غير معروفة. لا تُخترع بيانات.';
    RETURN NEXT;
    RETURN;
  END IF;

  v_sql := format(
    'SELECT e.%1$I::text, e.%2$I::text, i.stock, e.%3$I::numeric, NULL::text
       FROM public.egex_sync_staging e
       LEFT JOIN public.inventory_items i ON i.name = e.%2$I::text
      LIMIT 5000',
    v_store, v_item, v_qty
  );
  RETURN QUERY EXECUTE v_sql;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_egex_staging_compare() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_egex_staging_compare() TO authenticated, service_role;
