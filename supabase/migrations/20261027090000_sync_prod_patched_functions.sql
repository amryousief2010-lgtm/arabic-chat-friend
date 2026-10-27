-- Sync 8 functions hot-fixed directly in production (Lovable) so the repo matches the live DB.
-- Source: Lovable export 25 Oct 2026 (restored to rehearsal project). CREATE OR REPLACE only; ACLs preserved.

CREATE OR REPLACE FUNCTION private.invoke_scheduled_zodex_sync(p_mode text DEFAULT 'quick'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE s text; rid bigint; m text;
BEGIN
 m := CASE WHEN lower(btrim(coalesce(p_mode,'quick')))='full' THEN 'full' ELSE 'quick' END;
 SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name='zodex_cron_secret' LIMIT 1;
 IF s IS NULL OR btrim(s)='' THEN RETURN jsonb_build_object('skipped',true,'reason','missing_zodex_cron_secret'); END IF;
 rid := net.http_post(url:='https://ssznmzijopyxkwpctcxw.supabase.co/functions/v1/sync-zodex-shipments',headers:=jsonb_build_object('Content-Type','application/json','apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzem5temlqb3B5eGt3cGN0Y3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NjUwMDUsImV4cCI6MjA4MzA0MTAwNX0.YnU9drDx-s5V5T3J3t8zs6fa8F9yFse_Xb3J3e5qYMw','x-zodex-cron-secret',s),body:=jsonb_build_object('mode',m),timeout_milliseconds:=180000);
 RETURN jsonb_build_object('ok',true,'mode',m,'shipments_request_id',rid);
END; $function$
;
CREATE OR REPLACE FUNCTION public._dispatch_order_stock_core(p_order_id uuid, p_actor uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_commit_reservations boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order      record;
  v_item       record;
  v_canonical  uuid;
  v_cost       numeric;
  v_avail      numeric;
  v_stock      numeric;
  v_reserved   numeric;
  v_blocked    numeric;
  v_failures   int := 0;
  v_movements  int := 0;
  v_total_qty  numeric := 0;
  v_resv       int := 0;
  v_by         text := COALESCE(p_actor::text, 'system:auto_dispatch');
  v_lock       timestamptz;
  v_reason     text;
  v_details    jsonb := '[]'::jsonb;
  v_posted     jsonb;
BEGIN
  SELECT id, order_number, shipping_company, source_warehouse_id, stock_status, status, delivered_at
    INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND — الأوردر غير موجود';
  END IF;

  IF v_order.stock_status = 'skipped_period_lock' THEN
    RETURN jsonb_build_object('status','skipped_period_lock','order_id',p_order_id,'order_number',v_order.order_number);
  END IF;

  IF v_order.stock_status = 'dispatched' THEN
    PERFORM public._resolve_order_stock_dispatch_failures(p_order_id, v_by);
    RETURN jsonb_build_object('status','already_dispatched','order_id',p_order_id,'order_number',v_order.order_number);
  END IF;

  IF v_order.source_warehouse_id IS NOT NULL
     AND NOT public._order_auto_dispatch_allowed(v_order.source_warehouse_id, v_order.delivered_at) THEN
    RETURN jsonb_build_object('status','manual_warehouse_skipped','order_id',p_order_id,
      'message','المخزن الرئيسي: الأوردر اتسلّم قبل تفعيل الخصم التلقائي — لا يتم الخصم بأثر رجعي');
  END IF;

  v_lock := public.warehouse_period_locked_until(v_order.source_warehouse_id);
  IF v_lock IS NOT NULL AND v_order.delivered_at IS NOT NULL AND v_order.delivered_at < v_lock THEN
    UPDATE public.orders SET stock_status = 'skipped_period_lock' WHERE id = p_order_id;
    INSERT INTO public.order_period_lock_skips(order_id, warehouse_id, delivered_at, locked_until, note)
    SELECT p_order_id, v_order.source_warehouse_id, v_order.delivered_at, v_lock,
           'تسليم قبل قفل الجرد — بدون خصم حتى لا يُخصم المخزون مرتين'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.order_period_lock_skips s WHERE s.order_id = p_order_id
     );
    PERFORM public._resolve_order_stock_dispatch_failures(p_order_id, 'system:period_lock');
    RETURN jsonb_build_object('status','skipped_period_lock','order_id',p_order_id,
      'order_number', v_order.order_number, 'locked_until', v_lock);
  END IF;

  IF v_order.source_warehouse_id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'SOURCE_WAREHOUSE_UNRESOLVED — لم يتم تحديد المخزن المصدر للأوردر',
      DETAIL  = jsonb_build_array(jsonb_build_object('code','SOURCE_WAREHOUSE_UNRESOLVED'))::text;
  END IF;

  -- Delivery is the authority for every warehouse. The delivering user may not
  -- hold a stock-posting role. The flag is local to this transaction.
  PERFORM set_config('app.inventory_internal_post', 'on', true);

  FOR v_item IN
    SELECT oi.id AS order_item_id,
           oi.product_id,
           btrim(COALESCE(p.name, oi.product_name, '')) AS pname,
           oi.quantity::numeric AS qty,
           (oi.product_id IS NULL OR p.id IS NULL) AS missing_product,
           (p.id IS NOT NULL AND p.is_active IS NOT TRUE) AS inactive,
           (p.id IS NOT NULL AND (p.barcode IS NULL OR length(btrim(COALESCE(p.barcode, ''))) = 0)) AS no_barcode
      FROM public.order_items oi
      LEFT JOIN public.products p ON p.id = oi.product_id
     WHERE oi.order_id = p_order_id
       AND COALESCE(oi.quantity, 0) > 0
  LOOP
    v_reason := NULL;
    v_canonical := NULL;

    IF v_item.missing_product THEN
      v_reason := format('البند "%s" غير مربوط بمنتج', v_item.pname);
    ELSIF v_item.inactive THEN
      v_reason := format('المنتج "%s" غير نشط', v_item.pname);
    ELSIF v_item.no_barcode THEN
      v_reason := format('المنتج "%s" بدون باركود', v_item.pname);
    ELSE
      SELECT i.id, i.stock, COALESCE(i.reserved_qty, 0), COALESCE(i.blocked_qty, 0), COALESCE(i.unit_cost, 0)
        INTO v_canonical, v_stock, v_reserved, v_blocked, v_cost
        FROM public.inventory_items i
       WHERE i.product_id = v_item.product_id
         AND i.warehouse_id = v_order.source_warehouse_id
         AND COALESCE(i.is_active, true)
       ORDER BY i.id
       LIMIT 1
       FOR UPDATE;

      IF v_canonical IS NULL THEN
        v_reason := format('لا توجد بطاقة مخزون مربوطة بالمنتج "%s" في المخزن', v_item.pname);
      ELSE
        v_avail := COALESCE(v_stock, 0) - v_reserved - v_blocked;
        IF v_avail < v_item.qty AND NOT EXISTS (
          SELECT 1 FROM public.inventory_movements m
           WHERE m.source_type = 'order_delivery'
             AND m.source_id = p_order_id
             AND m.source_line_id = v_item.order_item_id::text
        ) THEN
          v_reason := format('رصيد "%s" غير كافٍ (المطلوب %s، المتاح %s)', v_item.pname, v_item.qty, v_avail);
        END IF;
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_failures := v_failures + 1;
      v_details := v_details || jsonb_build_object(
        'order_item_id', v_item.order_item_id,
        'product_id', v_item.product_id,
        'product_name', v_item.pname,
        'reason', v_reason
      );
      INSERT INTO public.order_deduction_lines(order_id, product_id, order_item_id, inventory_item_id, quantity, status, reason)
      VALUES (p_order_id, v_item.product_id, v_item.order_item_id, v_canonical, v_item.qty, 'failed', v_reason)
      ON CONFLICT (order_id, order_item_id) WHERE order_item_id IS NOT NULL DO UPDATE
        SET status = 'failed',
            reason = EXCLUDED.reason,
            inventory_item_id = EXCLUDED.inventory_item_id,
            quantity = EXCLUDED.quantity,
            product_id = EXCLUDED.product_id;
      CONTINUE;
    END IF;

    v_posted := public.post_inventory_movement(
      v_canonical, 'sales_dispatch', v_item.qty,
      'order_delivery', p_order_id, v_item.order_item_id::text,
      'صرف مبيعات',
      concat(
        'صرف تلقائي للأوردر ', v_order.order_number,
        ' canonical_item=', v_canonical::text,
        CASE WHEN p_note IS NOT NULL THEN ' — ' || p_note ELSE '' END
      ),
      COALESCE(v_order.delivered_at, now()),
      COALESCE(v_cost, 0),
      COALESCE(v_order.shipping_company, '—'),
      v_order.order_number,
      'delta', false,
      v_order.source_warehouse_id,
      v_item.product_id,
      'sales',
      NULL, NULL,
      'order', p_order_id::text,
      NULL, NULL, NULL,
      v_item.order_item_id
    );

    INSERT INTO public.order_deduction_lines(order_id, product_id, order_item_id, inventory_item_id, quantity, status, reason)
    VALUES (p_order_id, v_item.product_id, v_item.order_item_id, v_canonical, v_item.qty, 'posted', NULL)
    ON CONFLICT (order_id, order_item_id) WHERE order_item_id IS NOT NULL DO UPDATE
      SET status = 'posted',
          reason = NULL,
          inventory_item_id = EXCLUDED.inventory_item_id,
          quantity = EXCLUDED.quantity,
          product_id = EXCLUDED.product_id;

    v_movements := v_movements + 1;
    v_total_qty := v_total_qty + v_item.qty;
  END LOOP;

  IF v_failures > 0 THEN
    BEGIN
      PERFORM public._log_order_stock_dispatch_failure(
        p_order_id,
        'تعذّر خصم بعض بنود الأوردر',
        v_details::text,
        true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'order stock failure notification skipped: %', SQLERRM;
    END;
    PERFORM set_config('app.inventory_internal_post', 'off', true);
    RETURN jsonb_build_object(
      'status','partial_or_failed','order_id',p_order_id,'order_number',v_order.order_number,
      'movements', v_movements, 'failures', v_failures, 'details', v_details
    );
  END IF;

  PERFORM set_config('app.order_stock_posted', 'on', true); UPDATE public.orders SET stock_status = 'dispatched' WHERE id = p_order_id; PERFORM set_config('app.order_stock_posted', 'off', true);

  IF p_commit_reservations THEN
    v_resv := public._commit_order_reservations_after_dispatch(p_order_id, p_actor, 'dispatch_order_stock');
  END IF;

  UPDATE public.agouza_stock_reservations
     SET status = 'committed', committed_at = now(), committed_by = COALESCE(p_actor, auth.uid())
   WHERE order_id = p_order_id AND status = 'active';

  PERFORM public._resolve_order_stock_dispatch_failures(p_order_id, v_by);
  PERFORM set_config('app.inventory_internal_post', 'off', true);

  RETURN jsonb_build_object('status','dispatched','order_id',p_order_id,'order_number',v_order.order_number,
    'movements', v_movements, 'total_qty', v_total_qty, 'reservations_committed', v_resv);
END;
$function$
;
CREATE OR REPLACE FUNCTION public._return_order_dispatched_stock(p_order_id uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r    record;
  v_ii record;
  v_n  integer := 0;
BEGIN
  PERFORM set_config('app.inventory_internal_post', 'on', true);
  FOR r IN SELECT * FROM public._order_net_dispatched_items(p_order_id) LOOP
    SELECT id, warehouse_id, product_id, unit_cost, module INTO v_ii
      FROM public.inventory_items WHERE id = r.item_id FOR UPDATE;
    IF v_ii.id IS NULL THEN CONTINUE; END IF;

    PERFORM public.post_inventory_movement(
      v_ii.id, 'sales_return', r.net_qty,
      'order_return', p_order_id, v_ii.id::text,
      COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'مرتجع أوردر'),
      'إرجاع صرف الأوردر',
      now(), COALESCE(v_ii.unit_cost, 0), NULL, p_order_id::text,
      'delta', false,
      COALESCE(r.warehouse_id, v_ii.warehouse_id),
      v_ii.product_id, COALESCE(v_ii.module, 'sales'),
      NULL, NULL, 'order', p_order_id::text, NULL, NULL, NULL, NULL
    );
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('app.inventory_internal_post', 'off', true);
  RETURN v_n;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.approve_courier_cash_handover(p_txn_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_txn RECORD;
BEGIN
  IF p_txn_id IS NULL THEN RAISE EXCEPTION 'txn_id is required'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user
      AND role IN ('financial_manager','main_treasury_approver','general_manager','admin')
  ) THEN
    RAISE EXCEPTION 'صلاحية غير كافية لاعتماد التوريد';
  END IF;

  SELECT * INTO v_txn FROM public.main_warehouse_treasury_txns
  WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحركة غير موجودة'; END IF;
  IF v_txn.category <> 'courier_deposit' THEN
    RAISE EXCEPTION 'هذه الحركة ليست توريد نقدية مندوب';
  END IF;

  -- Idempotent: day-deposit path already posts; treat posted/approved as success.
  IF v_txn.status IN ('posted', 'approved') THEN
    UPDATE public.main_warehouse_treasury_txns
    SET approved_by = COALESCE(approved_by, v_user),
        approved_at = COALESCE(approved_at, now()),
        notes = CASE
          WHEN NULLIF(p_note,'') IS NULL THEN notes
          ELSE COALESCE(notes,'') || ' | تأكيد اعتماد: ' || p_note
        END
    WHERE id = p_txn_id
      AND (approved_by IS NULL OR approved_at IS NULL OR NULLIF(p_note,'') IS NOT NULL);
    RETURN jsonb_build_object(
      'ok', true,
      'txn_id', p_txn_id,
      'amount', v_txn.amount,
      'idempotent', true,
      'status', v_txn.status
    );
  END IF;

  IF v_txn.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'هذه الحركة ليست بانتظار الاعتماد (الحالة: %)', v_txn.status;
  END IF;

  UPDATE public.main_warehouse_treasury_txns
  SET status = 'posted',
      approved_by = v_user,
      approved_at = now(),
      notes = CASE
        WHEN NULLIF(p_note,'') IS NULL THEN notes
        ELSE COALESCE(notes,'') || ' | اعتماد: ' || p_note
      END
  WHERE id = p_txn_id;

  BEGIN
    INSERT INTO public.notifications(user_id, type, title, message, read)
    SELECT DISTINCT user_id, 'courier_cash_handover_approved',
      'تم اعتماد التوريد',
      'تم اعتماد توريد ' || v_txn.amount::text || ' ج.م من المندوب ' || COALESCE(v_txn.courier_name,''),
      false
    FROM public.user_roles
    WHERE role IN ('warehouse_manager','financial_manager');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'txn_id', p_txn_id, 'amount', v_txn.amount, 'idempotent', false);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.lookup_caller_by_phone(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_customer_id uuid;
  v_name text;
  v_area text;
  v_governorate text;
  v_customer_address text;
  v_orders jsonb;
  v_address text;
  v_total_spent numeric;
  v_orders_count integer;
  v_last_order jsonb;
  v_open_order jsonb;
  v_moderator text;
  v_top_products jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'sales_moderator'::public.app_role)
    OR public.has_any_role(v_uid, ARRAY[
      'general_manager',
      'executive_manager',
      'sales_manager',
      'marketing_sales_manager',
      'accountant',
      'warehouse_supervisor',
      'marketing_sales_viewer'
    ]::public.app_role[])
    OR public.is_social_media_manager(v_uid)
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Same unscoped customer SELECT policies already on public.customers.
  -- A role that can see every order but not customers (social_media_manager)
  -- gets no customer fields and no orders.
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager',
    'executive_manager',
    'sales_manager',
    'marketing_sales_manager',
    'marketing_sales_viewer',
    'sales_moderator',
    'accountant',
    'financial_manager',
    'warehouse_supervisor',
    'agouza_warehouse_keeper'
  ]::public.app_role[]) THEN
    RETURN jsonb_build_object(
      'match', 'none',
      'customer', NULL,
      'orders', '[]'::jsonb
    );
  END IF;

  v_phone := public.normalize_phone_eg(p_phone);
  -- Calls through the company hotline arrive with the Cairo area code
  -- in front of the full mobile: 02 01xxxxxxxxx, or +20 2 01xxxxxxxxx
  -- (which normalize_phone_eg leaves as 2 01xxxxxxxxx). Drop that extra
  -- prefix here only. normalize_phone_eg is shared with the duplicate
  -- order checks and stays unchanged. A real landline (02 + 8 digits)
  -- does not match either pattern and still returns invalid.
  IF v_phone ~ '^0201[0-9]{9}$' THEN
    v_phone := substr(v_phone, 3);
  ELSIF v_phone ~ '^201[0-9]{9}$' THEN
    v_phone := substr(v_phone, 2);
  END IF;
  -- 2 or 02 directly before a 10-digit mobile that lost its leading 0
  -- (21xxxxxxxxx / 021xxxxxxxxx): keep the last 10 digits and add the 0.
  IF v_phone ~ '^0?21[0125][0-9]{8}$' THEN
    v_phone := '0' || right(v_phone, 10);
  END IF;
  IF v_phone !~ '^01[0-9]{9}$' THEN
    RETURN jsonb_build_object(
      'match', 'invalid',
      'customer', NULL,
      'orders', '[]'::jsonb
    );
  END IF;

  SELECT c.id, c.name, c.area, c.governorate, c.address
    INTO v_customer_id, v_name, v_area, v_governorate, v_customer_address
  FROM public.customers c
  WHERE public.normalize_phone_eg(c.phone) = v_phone
     OR right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10) = right(v_phone, 10)
     OR (
       c.phone2 IS NOT NULL
       AND btrim(c.phone2) <> ''
       AND (
         public.normalize_phone_eg(c.phone2) = v_phone
         OR right(regexp_replace(c.phone2, '\D', '', 'g'), 10) = right(v_phone, 10)
       )
     )
  ORDER BY
    CASE
      WHEN public.normalize_phone_eg(c.phone) = v_phone THEN 0
      WHEN public.normalize_phone_eg(c.phone2) = v_phone THEN 1
      WHEN right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10) = right(v_phone, 10) THEN 2
      ELSE 3
    END,
    (
      SELECT max(o.created_at)
      FROM public.orders o
      WHERE o.customer_id = c.id
    ) DESC NULLS LAST,
    c.updated_at DESC NULLS LAST,
    c.created_at DESC
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object(
      'match', 'new',
      'customer', NULL,
      'orders', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'created_at', s.created_at,
        'status', s.status,
        'total', s.total
      )
      ORDER BY s.created_at DESC
    ),
    '[]'::jsonb
  )
    INTO v_orders
  FROM (
    SELECT o.created_at, o.status, o.total
    FROM public.orders o
    WHERE o.customer_id = v_customer_id
    ORDER BY o.created_at DESC
    LIMIT 8
  ) s;

  SELECT COALESCE(SUM(o.total), 0), COUNT(*)::integer
    INTO v_total_spent, v_orders_count
  FROM public.orders o
  WHERE o.customer_id = v_customer_id
    AND lower(btrim(o.status)) NOT IN ('cancelled', 'canceled', 'void', 'rejected');

  SELECT jsonb_build_object(
    'order_number', o.order_number,
    'created_at', o.created_at,
    'total', o.total,
    'status', o.status
  )
    INTO v_last_order
  FROM public.orders o
  WHERE o.customer_id = v_customer_id
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT 1;

  SELECT jsonb_build_object(
    'order_number', o.order_number,
    'status', o.status,
    'created_at', o.created_at,
    'total', o.total
  )
    INTO v_open_order
  FROM public.orders o
  WHERE o.customer_id = v_customer_id
    AND lower(btrim(o.status)) IS DISTINCT FROM 'delivered'
    AND lower(btrim(o.status)) NOT IN ('cancelled', 'canceled', 'void', 'rejected')
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT 1;

  v_address := NULLIF(btrim(v_customer_address), '');
  IF v_address IS NULL THEN
    SELECT NULLIF(btrim(o.delivery_address), '')
      INTO v_address
    FROM public.orders o
    WHERE o.customer_id = v_customer_id
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 1;
  END IF;

  SELECT COALESCE(NULLIF(btrim(o.moderator), ''), NULLIF(btrim(pd.full_name), ''))
    INTO v_moderator
  FROM public.orders o
  LEFT JOIN public.profile_directory pd ON pd.id = o.created_by
  WHERE o.customer_id = v_customer_id
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('name', t.name, 'qty', t.qty)
      ORDER BY t.qty DESC, t.name
    ),
    '[]'::jsonb
  )
    INTO v_top_products
  FROM (
    SELECT btrim(oi.product_name) AS name, SUM(oi.quantity) AS qty
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.customer_id = v_customer_id
      AND btrim(oi.product_name) <> ''
      AND lower(btrim(o.status)) NOT IN ('cancelled', 'canceled', 'void', 'rejected')
    GROUP BY btrim(oi.product_name)
    ORDER BY SUM(oi.quantity) DESC, btrim(oi.product_name)
    LIMIT 3
  ) t;

  RETURN jsonb_build_object(
    'match', 'customer',
    'customer', jsonb_build_object(
      'id', v_customer_id,
      'name', v_name,
      'area', v_area,
      'governorate', v_governorate,
      'last_contact', NULL
    ),
    'orders', v_orders,
    'total_spent', v_total_spent,
    'orders_count', v_orders_count,
    'last_order', v_last_order,
    'open_order', v_open_order,
    'address', v_address,
    'governorate', NULLIF(btrim(v_governorate), ''),
    'moderator', v_moderator,
    'top_products', v_top_products
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.record_courier_delivery_and_collection(p_assignment_id uuid, p_amount_collected numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_asn RECORD;
  v_order RECORD;
  v_courier text;
  v_custody_id uuid;
  v_due numeric;
  v_amt numeric;
  v_collection_status text;
  v_order_collection_status text;
  v_assignment_status text;
  v_tracking_status text;
  v_reference text;
  v_existing_line_id uuid;
  v_line_id uuid;
BEGIN
  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'assignment_id is required';
  END IF;

  SELECT a.id, a.custody_id, a.order_id, a.courier_name, a.status
    INTO v_asn
  FROM public.courier_order_assignments a
  WHERE a.id = p_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'التعيين غير موجود'; END IF;
  IF v_asn.status IN ('fully_returned','cancelled') THEN
    RAISE EXCEPTION 'الأوردر مرتجع/ملغي ولا يمكن تسجيل تسليم له';
  END IF;

  v_courier    := v_asn.courier_name;
  v_custody_id := v_asn.custody_id;

  SELECT o.id, o.order_number, o.customer_id, o.total, o.status
    INTO v_order
  FROM public.orders o
  WHERE o.id = v_asn.order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الأوردر غير موجود'; END IF;

  v_due := COALESCE(v_order.total, 0);
  v_amt := COALESCE(p_amount_collected, 0);
  IF v_amt < 0 THEN RAISE EXCEPTION 'مبلغ غير صالح'; END IF;

  v_reference := 'DELIV-' || COALESCE(NULLIF(p_idempotency_key,''),
                  to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS') || '-' || substr(v_asn.id::text,1,6));

  SELECT id INTO v_existing_line_id
  FROM public.courier_goods_custody_lines
  WHERE order_id = v_asn.order_id
    AND line_type = 'sale'
    AND notes LIKE '%' || v_reference || '%'
  LIMIT 1;

  IF v_existing_line_id IS NOT NULL THEN
    RETURN jsonb_build_object('reference', v_reference,'line_id', v_existing_line_id,'idempotent_hit', true);
  END IF;

  IF v_amt = 0 THEN
    v_collection_status := 'not_collected';
    v_order_collection_status := 'not_collected';
    v_assignment_status := 'delivered';
    v_tracking_status   := 'delivered';
  ELSIF v_amt < v_due THEN
    v_collection_status := 'partial_collected';
    v_order_collection_status := 'collected';
    v_assignment_status := 'delivered';
    v_tracking_status   := 'delivered';
  ELSE
    v_collection_status := 'cash_collected';
    v_order_collection_status := 'collected';
    v_assignment_status := 'completed';
    v_tracking_status   := 'collected';
  END IF;

  INSERT INTO public.courier_goods_custody_lines(
    custody_id, line_type, customer_id, customer_name, order_id,
    product_name, quantity, unit, unit_price, total_value, cash_collected,
    performed_at, performed_by, notes
  )
  SELECT
    v_custody_id, 'sale', v_order.customer_id, c.name, v_order.id,
    'أوردر ' || COALESCE(v_order.order_number,''), 1, 'أوردر', v_due, v_due, v_amt,
    now(), v_user,
    'تسليم وتحصيل — ' || v_reference || COALESCE(' | ' || NULLIF(p_notes,''), '')
  FROM (SELECT 1) x
  LEFT JOIN public.customers c ON c.id = v_order.customer_id
  RETURNING id INTO v_line_id;

  INSERT INTO public.pc_collections(
    order_id, amount_due, amount_collected, status, notes, collected_at, collected_by
  ) VALUES (
    v_order.id, v_due, v_amt, v_collection_status::pc_collection_status,
    p_notes, now(), v_user
  )
  ON CONFLICT (order_id) DO UPDATE SET
    amount_due = EXCLUDED.amount_due,
    amount_collected = EXCLUDED.amount_collected,
    status = EXCLUDED.status,
    notes = COALESCE(EXCLUDED.notes, public.pc_collections.notes),
    collected_at = EXCLUDED.collected_at,
    collected_by = EXCLUDED.collected_by,
    updated_at = now();

  UPDATE public.courier_order_assignments
     SET status = v_assignment_status,
         delivered_at = COALESCE(delivered_at, now()),
         collected_at = CASE WHEN v_amt >= v_due THEN now() ELSE collected_at END,
         notes = COALESCE(NULLIF(p_notes,''), notes),
         updated_at = now()
   WHERE id = p_assignment_id;

  INSERT INTO public.pc_order_tracking(order_id, courier_status, delivered_at, last_updated_by)
  VALUES (v_order.id, v_tracking_status::pc_courier_status, now(), v_user)
  ON CONFLICT (order_id) DO UPDATE SET
    courier_status = EXCLUDED.courier_status,
    delivered_at = COALESCE(public.pc_order_tracking.delivered_at, EXCLUDED.delivered_at),
    last_updated_by = EXCLUDED.last_updated_by,
    updated_at = now();

  UPDATE public.orders
     SET status = 'delivered',
         delivered_at = COALESCE(delivered_at, now()),
         delivered_by = COALESCE(delivered_by, v_user),
         total_at_delivery = COALESCE(total_at_delivery, v_due),
         collection_status = v_order_collection_status,
         collected_at = CASE
           WHEN v_amt > 0 THEN COALESCE(collected_at, now())
           ELSE collected_at
         END,
         collection_updated_at = now(),
         collection_updated_by = v_user,
         updated_at = now()
   WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'reference', v_reference,
    'line_id', v_line_id,
    'assignment_status', v_assignment_status,
    'collection_status', v_collection_status,
    'order_collection_status', v_order_collection_status,
    'amount_collected', v_amt,
    'amount_due', v_due,
    'idempotent_hit', false
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.retry_failed_order_dispatches(p_warehouse_id uuid, p_since date DEFAULT '2026-09-19'::date, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_agouza     constant uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
  v_uid        uuid := auth.uid();
  v_since_ts   timestamptz := (p_since::timestamp AT TIME ZONE 'Asia/Riyadh');
  v_main_from  timestamptz := public._main_wh_auto_dispatch_from();
  r            record;
  v_res        jsonb;
  v_err        text;
  v_detail     text;
  v_details    jsonb;
  v_note       text;
  v_was_open   boolean;
  v_candidates int := 0;
  v_dispatched int := 0;
  v_already    int := 0;
  v_skipped    int := 0;
  v_failed     int := 0;
  v_new_fail   int := 0;
  v_stale      int := 0;
  v_cleaned    int := 0;
  v_ok_list    jsonb := '[]'::jsonb;
  v_fail_list  jsonb := '[]'::jsonb;
  v_by_reason  jsonb;
  v_top        text;
BEGIN
  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد المخزن قبل إعادة محاولة الخصم';
  END IF;

  IF v_uid IS NOT NULL AND NOT public.has_any_role(v_uid, ARRAY['general_manager','executive_manager','warehouse_supervisor']::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  FOR r IN
    SELECT o.id, o.order_number, o.source_warehouse_id, o.delivered_at
    FROM public.orders o
    WHERE o.status = 'delivered'
      AND o.source_warehouse_id = p_warehouse_id
      AND COALESCE(o.stock_status,'not_dispatched') NOT IN ('dispatched', 'skipped_period_lock')
      AND ( (o.source_warehouse_id = c_agouza AND o.delivered_at >= v_since_ts)
         OR (COALESCE(public.is_manual_stock_warehouse(o.source_warehouse_id), false)
             AND v_main_from IS NOT NULL AND o.delivered_at >= v_main_from) )
    ORDER BY o.delivered_at
  LOOP
    v_candidates := v_candidates + 1;
    v_note := 'استكمال خصم متأخر (retry) — تاريخ التسليم الأصلي: '
              || to_char(r.delivered_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' بتوقيت الرياض';
    BEGIN
      v_res := public._dispatch_order_stock_core(r.id, v_uid, v_note, true);
      IF p_dry_run THEN
        RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = '__DRY_RUN__', DETAIL = v_res::text;
      END IF;
      IF v_res->>'status' = 'dispatched' THEN
        v_dispatched := v_dispatched + 1;
        v_ok_list := v_ok_list || to_jsonb(r.order_number);
      ELSIF v_res->>'status' = 'already_dispatched' THEN
        v_already := v_already + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'P0099' THEN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        v_res := v_detail::jsonb;
        IF v_res->>'status' = 'dispatched' THEN
          v_dispatched := v_dispatched + 1;
          v_ok_list := v_ok_list || to_jsonb(r.order_number);
        ELSIF v_res->>'status' = 'already_dispatched' THEN
          v_already := v_already + 1;
        ELSE
          v_skipped := v_skipped + 1;
        END IF;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
        v_failed := v_failed + 1;
        BEGIN v_details := v_detail::jsonb; EXCEPTION WHEN OTHERS THEN v_details := NULL; END;
        v_fail_list := v_fail_list || jsonb_build_object('order_id', r.id, 'order_number', r.order_number,
                                                         'error', v_err, 'details', v_details);
        IF NOT p_dry_run THEN
          v_was_open := EXISTS (SELECT 1 FROM public.order_stock_dispatch_failures
                                WHERE order_id = r.id AND resolved_at IS NULL);
          PERFORM public._log_order_stock_dispatch_failure(r.id, v_err, v_detail, false);
          IF NOT v_was_open THEN v_new_fail := v_new_fail + 1; END IF;
        END IF;
    END;
  END LOOP;

  IF NOT p_dry_run THEN
    FOR r IN
      SELECT DISTINCT asr.order_id
      FROM public.agouza_stock_reservations asr
      JOIN public.orders o ON o.id = asr.order_id
      WHERE asr.status = 'active' AND o.status = 'delivered' AND o.stock_status = 'dispatched'
        AND EXISTS (SELECT 1 FROM public._order_net_dispatched_items(o.id))
    LOOP
      v_stale := v_stale + public._commit_order_reservations_after_dispatch(r.order_id, v_uid, 'stale_active_after_dispatch_cleanup');
    END LOOP;

    UPDATE public.order_stock_dispatch_failures f
       SET resolved_at = now(), resolved_by = 'system:retry_cleanup'
      FROM public.orders o
     WHERE o.id = f.order_id AND f.resolved_at IS NULL
       AND (o.status <> 'delivered' OR o.stock_status = 'dispatched');
    GET DIAGNOSTICS v_cleaned = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_stale
    FROM public.agouza_stock_reservations asr
    JOIN public.orders o ON o.id = asr.order_id
    WHERE asr.status = 'active' AND o.status = 'delivered' AND o.stock_status = 'dispatched'
      AND EXISTS (SELECT 1 FROM public._order_net_dispatched_items(o.id));
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'product', product, 'orders', n) ORDER BY n DESC, code, product), '[]'::jsonb)
    INTO v_by_reason
  FROM (
    SELECT i->>'code' AS code, COALESCE(i->>'product_name', '-') AS product, count(DISTINCT f->>'order_id') AS n
    FROM jsonb_array_elements(v_fail_list) f,
         jsonb_array_elements(CASE WHEN jsonb_typeof(f->'details') = 'array' THEN f->'details' ELSE '[]'::jsonb END) i
    GROUP BY 1, 2
  ) s;

  IF NOT p_dry_run AND v_new_fail > 0 THEN
    SELECT string_agg(
             (e->>'product') || ': ' ||
             CASE e->>'code'
               WHEN 'INSUFFICIENT_STOCK'    THEN 'رصيد غير كافٍ'
               WHEN 'PRODUCT_NO_BARCODE'    THEN 'بدون باركود'
               WHEN 'INVENTORY_ROW_MISSING' THEN 'غير موجود بالمخزن'
               WHEN 'PRODUCT_INACTIVE'      THEN 'منتج غير نشط'
               WHEN 'PRODUCT_MISSING'       THEN 'بند بدون منتج'
               ELSE e->>'code' END
             || ' (' || (e->>'orders') || ')', '، ')
      INTO v_top
    FROM (SELECT e FROM jsonb_array_elements(v_by_reason) e LIMIT 6) t;

    INSERT INTO public.notifications(title, description, type, order_id, target_user_id)
    SELECT '⚠️ أوردرات مسلّمة بدون خصم مخزون',
           'مراجعة خصم المخزون للأوردرات المسلّمة منذ ' || p_since::text || ': تم خصم ' || v_dispatched
             || ' أوردر الآن، وما زال ' || v_failed || ' أوردر معلقاً بدون خصم. أهم الأسباب: ' || COALESCE(v_top, '-')
             || '. سيتم الخصم عند إعادة المحاولة بعد استلام التحويلات وتصحيح البيانات.',
           'stock_dispatch_failed', NULL, u.user_id
    FROM (SELECT DISTINCT ur.user_id FROM public.user_roles ur
          WHERE ur.role::text IN ('warehouse_supervisor','general_manager','executive_manager')) u;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'warehouse_id', p_warehouse_id,
    'since', p_since,
    'main_wh_auto_dispatch_from', v_main_from,
    'candidates', v_candidates,
    'dispatched', v_dispatched,
    'already_dispatched', v_already,
    'skipped', v_skipped,
    'still_failing', v_failed,
    'new_failures_logged', v_new_fail,
    'stale_active_reservations_committed', v_stale,
    'failures_auto_resolved', v_cleaned,
    'failures_by_reason_product', v_by_reason,
    'dispatched_orders', v_ok_list,
    'failing_orders', v_fail_list
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_guard_farm_shipment_receive()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND LOWER(COALESCE(NEW.status, '')) IN ('received', 'partial')
     AND LOWER(COALESCE(OLD.status, '')) IS DISTINCT FROM LOWER(COALESCE(NEW.status, ''))
  THEN
    IF LOWER(COALESCE(OLD.status, '')) IN ('cancelled', 'rejected') THEN
      RAISE EXCEPTION 'لا يمكن استلام شحنة مرفوضة/ملغاة. استخدم «تحميل وارد المزرعة» من شاشة المعمل.';
    END IF;

    IF NEW.farm_transfer_id IS NULL THEN
      RAISE EXCEPTION 'استلام الشحنات اليتيمة/القديمة من صندوق الوارد معطّل. المسار الصحيح: «تحميل وارد المزرعة» فقط.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.farm_to_hatchery_shipments r
      WHERE r.id <> NEW.id
        AND r.status IN ('received', 'partial')
        AND r.production_id IS NOT DISTINCT FROM NEW.production_id
        AND r.production_date = NEW.production_date
        AND r.egg_count = NEW.egg_count
    ) THEN
      RAISE EXCEPTION 'هذه الشحنة مكررة لشحنة مستلمة مسبقاً — تم حظر الاستلام لمنع دفعات تفريخ وهمية.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;
