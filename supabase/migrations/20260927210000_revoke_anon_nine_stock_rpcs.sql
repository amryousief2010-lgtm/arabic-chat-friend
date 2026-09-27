-- Revoke anon/PUBLIC on the nine stock RPCs that had no caller check,
-- and require a signed-in screen role. service_role and trigger callers
-- keep working. transfer_between_sublocations also rejects is_card_mirror
-- (warehouse-cycle conflict 3). Default privileges for roles that create
-- functions in public no longer grant EXECUTE to anon or PUBLIC.
-- product_sale_price(uuid) stays explicitly granted to anon.
-- is_manual_stock_warehouse has no anon/frontend caller (SQL only).

-- Role lists (screens):
-- approve_distribution_dispatch: general_manager, executive_manager,
--   warehouse_supervisor, agouza_warehouse_keeper, sales_manager,
--   sales_moderator, marketing_sales_manager.
--   Screen: Warehouses.tsx tabs تجهيز خط التوزيع / تجهيز خط توزيع العجوزة
--   (RouteDistributionPreparationTab). Route /modules/warehouses is wider;
--   viewers and unrelated hub roles are not distribution operators.
-- finalize_meat_production, meat_production_transfer_to_main:
--   general_manager, executive_manager, meat_factory_manager,
--   production_manager, financial_manager, warehouse_supervisor.
--   Screen: MeatProductionWarehouses.tsx on /meat-factory/warehouses.
-- transfer_between_sublocations: general_manager, executive_manager,
--   warehouse_supervisor, agouza_warehouse_keeper, production_manager.
--   Screen: SubLocationDistributionDialog from WarehouseStockView توزيع.
--   Sales viewers can open the stock page; stock edits are the roles above.
-- get_or_create_wh_item: general_manager, executive_manager,
--   warehouse_supervisor, agouza_warehouse_keeper, production_manager,
--   meat_factory_manager. No frontend rpc; card create matches
--   canManageWarehouses plus the meat factory manager.
-- ensure_brooding_feed_row: general_manager, executive_manager,
--   feed_factory_manager, brooding_manager, production_manager,
--   warehouse_supervisor. Direct rpc only; feed_sale_item_route_internal
--   is a trigger and bypasses the role check.
-- ensure_slaughter_feed_row, ensure_slaughter_feed_raw_row:
--   general_manager, executive_manager, feed_factory_manager,
--   slaughterhouse_manager, production_manager, warehouse_supervisor.
--   Same trigger bypass.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'anon, authenticated, and service_role must exist';
  END IF;
END $$;

-- A schema-only revoke does not remove PostgreSQL's hard-wired PUBLIC
-- execute: that grant is merged back in when the function is created.
-- Revoke it for the creating role globally, and also in schema public so an
-- explicit anon grant stored on that schema (live pg_default_acl) is removed.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin')
     AND pg_has_role(current_user, 'supabase_admin', 'MEMBER') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.approve_distribution_dispatch(p_custody_id uuid, p_warehouse_id uuid, p_order_ids uuid[], p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_custody RECORD;
  v_courier text;
  v_reference text;
  v_existing_count int;
  v_movement_ids uuid[] := ARRAY[]::uuid[];
  v_unresolved text[] := ARRAY[]::text[];
  v_items_count int := 0;
  v_orders_count int := 0;
  v_item RECORD;
  v_inv RECORD;
  v_order RECORD;
  v_mov_id uuid;
  v_assigned_existing int;
BEGIN
  -- Signed-in callers must hold a screen role. A trigger on the stack,
  -- and a caller with no auth.uid() (service_role or the database owner),
  -- keeps working. request.jwt.claim.role is not a bypass.
  IF pg_trigger_depth() = 0
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::public.app_role,
      'executive_manager'::public.app_role,
      'warehouse_supervisor'::public.app_role,
      'agouza_warehouse_keeper'::public.app_role,
      'sales_manager'::public.app_role,
      'sales_moderator'::public.app_role,
      'marketing_sales_manager'::public.app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: تجهيز خط التوزيع لأدوار التوزيع والمخازن';
  END IF;

  PERFORM set_config('app.inventory_bridge_insert', 'on', true);
  PERFORM set_config('app.inventory_ledger_posted', 'on', true);
  IF p_custody_id IS NULL THEN RAISE EXCEPTION 'custody_id is required'; END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'warehouse_id is required'; END IF;
  IF p_order_ids IS NULL OR array_length(p_order_ids,1) IS NULL THEN
    RAISE EXCEPTION 'يجب اختيار طلب واحد على الأقل';
  END IF;

  SELECT id, courier_name, status INTO v_custody
  FROM public.courier_goods_custodies
  WHERE id = p_custody_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العهدة غير موجودة'; END IF;
  IF v_custody.status <> 'open' THEN RAISE EXCEPTION 'العهدة ليست مفتوحة (الحالة: %)', v_custody.status; END IF;
  v_courier := v_custody.courier_name;

  IF p_idempotency_key IS NOT NULL AND length(p_idempotency_key) > 0 THEN
    v_reference := 'DIST-' || p_idempotency_key;
    SELECT count(*) INTO v_existing_count FROM public.inventory_movements WHERE reference = v_reference;
    IF v_existing_count > 0 THEN
      SELECT array_agg(id) INTO v_movement_ids FROM public.inventory_movements WHERE reference = v_reference;
      RETURN jsonb_build_object('reference', v_reference, 'movement_ids', to_jsonb(v_movement_ids),
        'orders_count', array_length(p_order_ids,1), 'items_count', v_existing_count,
        'unresolved', to_jsonb(ARRAY[]::text[]), 'idempotent_hit', true);
    END IF;
  ELSE
    v_reference := 'DIST-' || to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS') || '-' || substr(p_custody_id::text,1,6);
  END IF;

  SELECT count(*) INTO v_assigned_existing FROM public.courier_order_assignments
  WHERE order_id = ANY(p_order_ids) AND status NOT IN ('fully_returned','cancelled');
  IF v_assigned_existing > 0 THEN
    RAISE EXCEPTION 'يوجد % طلب مرتبط بالفعل بعهدة نشطة', v_assigned_existing;
  END IF;

  FOR v_item IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.unit_price, NULL::text AS unit
    FROM public.order_items oi WHERE oi.order_id = ANY(p_order_ids)
  LOOP
    SELECT o.id, o.order_number, o.status, o.customer_id, c.name AS customer_name INTO v_order
    FROM public.orders o LEFT JOIN public.customers c ON c.id = o.customer_id WHERE o.id = v_item.order_id;

    SELECT id, unit_cost INTO v_inv FROM public.inventory_items
    WHERE warehouse_id = p_warehouse_id AND is_active = true AND product_id = v_item.product_id LIMIT 1;

    IF NOT FOUND THEN
      v_unresolved := array_append(v_unresolved, v_item.product_name);
      CONTINUE;
    END IF;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, source_warehouse_id, movement_type, quantity,
      unit_cost, party, reference, reference_type, reference_id, module,
      reason, notes, performed_by, performed_at, product_id, order_item_id, approval_status
    ) VALUES (
      v_inv.id, p_warehouse_id, p_warehouse_id, 'out', COALESCE(v_item.quantity,0),
      COALESCE(v_inv.unit_cost,0), 'عهدة المندوب — ' || v_courier, v_reference,
      'courier_custody', p_custody_id::text, 'courier_distribution', 'صرف خط توزيع',
      trim(coalesce(v_order.order_number,'') || ' — ' || coalesce(v_order.customer_name,'')),
      v_user, now(), v_item.product_id, v_item.id, 'posted'
    ) RETURNING id INTO v_mov_id;

    v_movement_ids := array_append(v_movement_ids, v_mov_id);
    v_items_count := v_items_count + 1;

    INSERT INTO public.courier_goods_custody_lines(
      custody_id, line_type, customer_id, customer_name, order_id,
      inventory_item_id, inventory_movement_id, product_name,
      quantity, unit, unit_price, total_value, cash_collected,
      performed_at, performed_by, notes
    ) VALUES (
      p_custody_id, 'issue', v_order.customer_id, v_order.customer_name, v_item.order_id,
      v_inv.id, v_mov_id, v_item.product_name,
      COALESCE(v_item.quantity,0), COALESCE(v_item.unit,'وحدة'),
      COALESCE(v_item.unit_price,0),
      COALESCE(v_item.quantity,0) * COALESCE(v_item.unit_price,0), 0,
      now(), v_user, 'صرف خط ' || v_reference || ' — ' || coalesce(v_order.order_number,'')
    );
  END LOOP;

  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'لم يتم إنشاء أي حركة. الأصناف غير مرتبطة بالمخزن المحدد: %', array_to_string(v_unresolved, ', ');
  END IF;

  FOR v_order IN SELECT id, order_number FROM public.orders WHERE id = ANY(p_order_ids)
  LOOP
    INSERT INTO public.courier_order_assignments(order_id, custody_id, courier_name, status, assigned_at, assigned_by)
    VALUES (v_order.id, p_custody_id, v_courier, 'with_courier', now(), v_user);
    v_orders_count := v_orders_count + 1;
  END LOOP;

  UPDATE public.orders SET status = 'processing', stock_status = 'dispatched', updated_at = now()
  WHERE id = ANY(p_order_ids);

  RETURN jsonb_build_object('reference', v_reference, 'movement_ids', to_jsonb(v_movement_ids),
    'orders_count', v_orders_count, 'items_count', v_items_count,
    'unresolved', to_jsonb(v_unresolved), 'idempotent_hit', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_distribution_dispatch(p_custody_id uuid, p_warehouse_id uuid, p_order_ids uuid[], p_idempotency_key text DEFAULT NULL::text, p_override_negative boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_custody RECORD;
  v_courier text;
  v_reference text;
  v_existing_count int;
  v_movement_ids uuid[] := ARRAY[]::uuid[];
  v_unresolved text[] := ARRAY[]::text[];
  v_items_count int := 0;
  v_orders_count int := 0;
  v_item RECORD;
  v_inv RECORD;
  v_order RECORD;
  v_mov_id uuid;
  v_assigned_existing int;
  v_shortages jsonb := '[]'::jsonb;
  v_short RECORD;
BEGIN
  -- Signed-in callers must hold a screen role. A trigger on the stack,
  -- and a caller with no auth.uid() (service_role or the database owner),
  -- keeps working. request.jwt.claim.role is not a bypass.
  IF pg_trigger_depth() = 0
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::public.app_role,
      'executive_manager'::public.app_role,
      'warehouse_supervisor'::public.app_role,
      'agouza_warehouse_keeper'::public.app_role,
      'sales_manager'::public.app_role,
      'sales_moderator'::public.app_role,
      'marketing_sales_manager'::public.app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: تجهيز خط التوزيع لأدوار التوزيع والمخازن';
  END IF;

  PERFORM set_config('app.inventory_bridge_insert', 'on', true);
  PERFORM set_config('app.inventory_ledger_posted', 'on', true);
  IF p_custody_id IS NULL THEN RAISE EXCEPTION 'custody_id is required'; END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'warehouse_id is required'; END IF;
  IF p_order_ids IS NULL OR array_length(p_order_ids,1) IS NULL THEN
    RAISE EXCEPTION 'يجب اختيار طلب واحد على الأقل';
  END IF;

  SELECT id, courier_name, status INTO v_custody
  FROM public.courier_goods_custodies WHERE id = p_custody_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العهدة غير موجودة'; END IF;
  IF v_custody.status <> 'open' THEN RAISE EXCEPTION 'العهدة ليست مفتوحة (الحالة: %)', v_custody.status; END IF;
  v_courier := v_custody.courier_name;

  IF p_idempotency_key IS NOT NULL AND length(p_idempotency_key) > 0 THEN
    v_reference := 'DIST-' || p_idempotency_key;
    SELECT count(*) INTO v_existing_count FROM public.inventory_movements WHERE reference = v_reference;
    IF v_existing_count > 0 THEN
      SELECT array_agg(id) INTO v_movement_ids FROM public.inventory_movements WHERE reference = v_reference;
      RETURN jsonb_build_object(
        'reference', v_reference,
        'movement_ids', to_jsonb(v_movement_ids),
        'orders_count', array_length(p_order_ids,1),
        'items_count', v_existing_count,
        'unresolved', to_jsonb(ARRAY[]::text[]),
        'idempotent_hit', true
      );
    END IF;
  ELSE
    v_reference := 'DIST-' || to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS') || '-' || substr(p_custody_id::text,1,6);
  END IF;

  FOR v_short IN
    SELECT
      p.product_name,
      SUM(p.required)::numeric AS required,
      MAX(COALESCE(ii.stock - ii.reserved_qty - ii.blocked_qty, 0))::numeric AS available
    FROM (
      SELECT oi.product_id, oi.product_name, SUM(COALESCE(oi.quantity,0)) AS required
      FROM public.order_items oi
      WHERE oi.order_id = ANY(p_order_ids)
      GROUP BY oi.product_id, oi.product_name
    ) p
    LEFT JOIN public.inventory_items ii
      ON ii.warehouse_id = p_warehouse_id AND ii.is_active = true AND ii.product_id = p.product_id
    GROUP BY p.product_name
    HAVING SUM(p.required) > MAX(COALESCE(ii.stock - ii.reserved_qty - ii.blocked_qty, 0))
  LOOP
    v_shortages := v_shortages || jsonb_build_object(
      'product_name', v_short.product_name,
      'required', v_short.required,
      'available', v_short.available,
      'shortage', v_short.required - v_short.available
    );
  END LOOP;

  IF jsonb_array_length(v_shortages) > 0 AND NOT p_override_negative THEN
    RETURN jsonb_build_object(
      'needs_override', true,
      'shortages', v_shortages,
      'reference', v_reference
    );
  END IF;

  SELECT count(*) INTO v_assigned_existing
  FROM public.courier_order_assignments
  WHERE order_id = ANY(p_order_ids) AND status NOT IN ('fully_returned','cancelled');
  IF v_assigned_existing > 0 THEN
    RAISE EXCEPTION 'يوجد % طلب مرتبط بالفعل بعهدة نشطة', v_assigned_existing;
  END IF;

  IF p_override_negative THEN
    PERFORM set_config('app.allow_negative_stock', 'on', true);
  END IF;

  FOR v_item IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.unit_price, NULL::text AS unit
    FROM public.order_items oi WHERE oi.order_id = ANY(p_order_ids)
  LOOP
    SELECT o.id, o.order_number, o.status, o.customer_id, c.name AS customer_name
    INTO v_order
    FROM public.orders o LEFT JOIN public.customers c ON c.id = o.customer_id
    WHERE o.id = v_item.order_id;

    SELECT id, unit_cost INTO v_inv
    FROM public.inventory_items
    WHERE warehouse_id = p_warehouse_id AND is_active = true AND product_id = v_item.product_id
    LIMIT 1;

    IF NOT FOUND THEN
      v_unresolved := array_append(v_unresolved, v_item.product_name);
      CONTINUE;
    END IF;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, source_warehouse_id, movement_type, quantity,
      unit_cost, party, reference, reference_type, reference_id, module,
      reason, notes, performed_by, performed_at, product_id, order_item_id, approval_status
    ) VALUES (
      v_inv.id, p_warehouse_id, p_warehouse_id, 'out', COALESCE(v_item.quantity,0),
      COALESCE(v_inv.unit_cost,0), 'عهدة المندوب — ' || v_courier, v_reference,
      'courier_custody', p_custody_id::text, 'courier_distribution',
      CASE WHEN p_override_negative THEN 'صرف خط توزيع (تجاوز رصيد)' ELSE 'صرف خط توزيع' END,
      trim(coalesce(v_order.order_number,'') || ' — ' || coalesce(v_order.customer_name,'')),
      v_user, now(), v_item.product_id, v_item.id, 'posted'
    ) RETURNING id INTO v_mov_id;

    v_movement_ids := array_append(v_movement_ids, v_mov_id);
    v_items_count := v_items_count + 1;

    INSERT INTO public.courier_goods_custody_lines(
      custody_id, line_type, customer_id, customer_name, order_id,
      inventory_item_id, inventory_movement_id, product_name,
      quantity, unit, unit_price, total_value, cash_collected,
      performed_at, performed_by, notes
    ) VALUES (
      p_custody_id, 'issue', v_order.customer_id, v_order.customer_name, v_item.order_id,
      v_inv.id, v_mov_id, v_item.product_name,
      COALESCE(v_item.quantity,0), COALESCE(v_item.unit,'وحدة'),
      COALESCE(v_item.unit_price,0),
      COALESCE(v_item.quantity,0) * COALESCE(v_item.unit_price,0), 0,
      now(), v_user,
      'صرف خط ' || v_reference || ' — ' || coalesce(v_order.order_number,'')
    );
  END LOOP;

  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'لم يتم إنشاء أي حركة. الأصناف غير مرتبطة بالمخزن المحدد: %', array_to_string(v_unresolved, ', ');
  END IF;

  FOR v_order IN SELECT id, order_number FROM public.orders WHERE id = ANY(p_order_ids) LOOP
    INSERT INTO public.courier_order_assignments(order_id, custody_id, courier_name, status, assigned_at, assigned_by)
    VALUES (v_order.id, p_custody_id, v_courier, 'with_courier', now(), v_user);
    v_orders_count := v_orders_count + 1;
  END LOOP;

  UPDATE public.orders
    SET status = 'processing', stock_status = 'dispatched', updated_at = now()
    WHERE id = ANY(p_order_ids);

  RETURN jsonb_build_object(
    'reference', v_reference,
    'movement_ids', to_jsonb(v_movement_ids),
    'orders_count', v_orders_count,
    'items_count', v_items_count,
    'unresolved', to_jsonb(v_unresolved),
    'shortages', v_shortages,
    'override_applied', p_override_negative,
    'idempotent_hit', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.meat_production_transfer_to_main(_product_id uuid, _qty numeric, _invoice_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock numeric; v_cost numeric;
  v_main_wh uuid; v_transfer_id uuid;
  v_product_name text;
BEGIN
  -- Signed-in callers must hold a screen role. A trigger on the stack,
  -- and a caller with no auth.uid() (service_role or the database owner),
  -- keeps working. request.jwt.claim.role is not a bypass.
  IF pg_trigger_depth() = 0
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::public.app_role,
      'executive_manager'::public.app_role,
      'meat_factory_manager'::public.app_role,
      'production_manager'::public.app_role,
      'financial_manager'::public.app_role,
      'warehouse_supervisor'::public.app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: تصنيع اللحوم والتحويل للمدير أو مدير المصنع أو مسؤول المخزن أو المدير المالي';
  END IF;

  PERFORM set_config('app.named_stock_source_type', 'fn:meat_production_transfer_to_main', true);
  PERFORM set_config('app.named_stock_source_id', COALESCE(_invoice_id, _product_id)::text, true);
  PERFORM set_config('app.named_stock_reason', 'ترحيل meat_production_transfer_to_main', true);

  IF _qty IS NULL OR _qty <= 0 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر';
  END IF;

  SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost,0), name_ar
    INTO v_stock, v_cost, v_product_name
    FROM meat_factory_products WHERE id = _product_id;

  IF v_stock < _qty THEN
    RAISE EXCEPTION 'الرصيد المتاح من المنتج التام (%) أقل من الكمية المطلوب تحويلها (%)', v_stock, _qty;
  END IF;

  SELECT id INTO v_main_wh FROM warehouses
    WHERE is_active = true AND (name LIKE '%الرئيسي%' OR name LIKE '%المقر%')
    ORDER BY name LIMIT 1;

  IF v_main_wh IS NULL THEN
    RAISE EXCEPTION 'لم يتم العثور على المخزن الرئيسي';
  END IF;

  -- Deduct from finished factory stock (reserved until approval / released on rejection)
  PERFORM set_config('app.named_stock_source_line', 's1', true); PERFORM set_config('app.named_stock_armed', 'on', true); UPDATE meat_factory_products
     SET /*named*/ current_stock = GREATEST(0, COALESCE(current_stock,0) - _qty),
         updated_at = now()
   WHERE id = _product_id;

  -- Log transfer as PENDING — no inventory movement created yet
  INSERT INTO meat_production_transfers
    (invoice_id, product_id, destination_warehouse_id, quantity, unit_cost, total_cost, notes, created_by, status)
  VALUES (_invoice_id, _product_id, v_main_wh, _qty, v_cost, _qty * v_cost, _notes, auth.uid(), 'pending')
  RETURNING id INTO v_transfer_id;

  -- Update invoice running tally
  IF _invoice_id IS NOT NULL THEN
    UPDATE meat_production_invoices
      SET transferred_to_main_qty = COALESCE(transferred_to_main_qty,0) + _qty,
          updated_at = now()
      WHERE id = _invoice_id;
  END IF;

  RETURN v_transfer_id;
END $function$;

CREATE OR REPLACE FUNCTION public.finalize_meat_production(_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric; v_qty numeric; v_prod uuid;
  v_old_stock numeric; v_old_cost numeric; v_new_cost numeric;
BEGIN
  -- Signed-in callers must hold a screen role. A trigger on the stack,
  -- and a caller with no auth.uid() (service_role or the database owner),
  -- keeps working. request.jwt.claim.role is not a bypass.
  IF pg_trigger_depth() = 0
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::public.app_role,
      'executive_manager'::public.app_role,
      'meat_factory_manager'::public.app_role,
      'production_manager'::public.app_role,
      'financial_manager'::public.app_role,
      'warehouse_supervisor'::public.app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: تصنيع اللحوم والتحويل للمدير أو مدير المصنع أو مسؤول المخزن أو المدير المالي';
  END IF;

  PERFORM set_config('app.named_stock_source_type', 'fn:finalize_meat_production', true);
  PERFORM set_config('app.named_stock_source_id', _invoice_id::text, true);
  PERFORM set_config('app.named_stock_reason', 'ترحيل finalize_meat_production', true);

  SELECT COALESCE(SUM(line_cost),0) INTO v_total
    FROM meat_production_invoice_items WHERE invoice_id = _invoice_id;

  SELECT qty_produced, product_id INTO v_qty, v_prod
    FROM meat_production_invoices WHERE id = _invoice_id;

  SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost,0)
    INTO v_old_stock, v_old_cost
    FROM meat_factory_products WHERE id = v_prod;

  IF (v_old_stock + v_qty) > 0 THEN
    v_new_cost := ((v_old_stock*v_old_cost) + v_total) / (v_old_stock + v_qty);
  ELSE
    v_new_cost := 0;
  END IF;

  PERFORM set_config('app.named_stock_source_line', 's1', true); PERFORM set_config('app.named_stock_armed', 'on', true); UPDATE meat_factory_products
     SET /*named*/ current_stock = COALESCE(current_stock,0) + v_qty,
         latest_unit_cost = v_new_cost,
         updated_at = now()
   WHERE id = v_prod;

  UPDATE meat_production_invoices
     SET total_cost = v_total,
         unit_cost = CASE WHEN v_qty > 0 THEN v_total / v_qty ELSE 0 END,
         updated_at = now()
   WHERE id = _invoice_id;
END $function$;

CREATE OR REPLACE FUNCTION public.transfer_between_sublocations(p_product_id uuid, p_from_sublocation_id uuid, p_to_sublocation_id uuid, p_qty numeric, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from_stock NUMERIC;
  v_move_id UUID;
  v_from_wh UUID;
  v_to_wh UUID;
  v_main_reserved NUMERIC := 0;
  v_sub_total NUMERIC := 0;
  v_reserved_share NUMERIC := 0;
  v_real_available NUMERIC := 0;
BEGIN
  -- Signed-in callers must hold a screen role. A trigger on the stack,
  -- and a caller with no auth.uid() (service_role or the database owner),
  -- keeps working. request.jwt.claim.role is not a bypass.
  IF pg_trigger_depth() = 0
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::public.app_role,
      'executive_manager'::public.app_role,
      'warehouse_supervisor'::public.app_role,
      'agouza_warehouse_keeper'::public.app_role,
      'production_manager'::public.app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: النقل بين المواقع للمدير أو مسؤول المخزن';
  END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر';
  END IF;
  IF p_from_sublocation_id = p_to_sublocation_id THEN
    RAISE EXCEPTION 'لا يمكن النقل إلى نفس المكان';
  END IF;

  SELECT warehouse_id INTO v_from_wh FROM public.warehouse_sublocations WHERE id = p_from_sublocation_id;
  SELECT warehouse_id INTO v_to_wh FROM public.warehouse_sublocations WHERE id = p_to_sublocation_id;
  IF v_from_wh IS NULL OR v_to_wh IS NULL OR v_from_wh <> v_to_wh THEN
    RAISE EXCEPTION 'المكانين يجب أن يكونا في نفس المخزن';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.inventory_sublocation_items m
     WHERE m.product_id = p_product_id
       AND m.sublocation_id IN (p_from_sublocation_id, p_to_sublocation_id)
       AND m.is_card_mirror
  ) THEN
    RAISE EXCEPTION 'CARD_MIRROR: لا يمكن نقل كمية من أو إلى صف مرآة البطاقة';
  END IF;


  SELECT stock INTO v_from_stock FROM public.inventory_sublocation_items
    WHERE sublocation_id = p_from_sublocation_id AND product_id = p_product_id
    FOR UPDATE;
  IF v_from_stock IS NULL THEN v_from_stock := 0; END IF;

  -- Compute proportional reserved share for this sublocation
  SELECT COALESCE(SUM(isi.stock), 0) INTO v_sub_total
  FROM public.inventory_sublocation_items isi
  JOIN public.warehouse_sublocations s ON s.id = isi.sublocation_id
  WHERE s.warehouse_id = v_from_wh AND isi.product_id = p_product_id;

  SELECT COALESCE(SUM(reserved_qty), 0) INTO v_main_reserved
  FROM public.inventory_items
  WHERE warehouse_id = v_from_wh AND product_id = p_product_id;

  IF v_sub_total > 0 AND v_main_reserved > 0 THEN
    v_reserved_share := (v_main_reserved * v_from_stock / v_sub_total);
  END IF;
  v_real_available := v_from_stock - v_reserved_share;

  IF p_qty > v_real_available THEN
    RAISE EXCEPTION 'الكمية المطلوبة (%) أكبر من المتاح الحقيقي (%) — باقي الكمية محجوزة لأوردرات', p_qty, ROUND(v_real_available, 3);
  END IF;

  UPDATE public.inventory_sublocation_items
    SET stock = stock - p_qty
    WHERE sublocation_id = p_from_sublocation_id AND product_id = p_product_id;

  INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock)
    VALUES (p_to_sublocation_id, p_product_id, p_qty)
    ON CONFLICT (sublocation_id, product_id)
    DO UPDATE SET stock = public.inventory_sublocation_items.stock + EXCLUDED.stock;

  INSERT INTO public.sublocation_movements
    (product_id, from_sublocation_id, to_sublocation_id, qty, notes, created_by, source)
    VALUES (p_product_id, p_from_sublocation_id, p_to_sublocation_id, p_qty, p_notes, auth.uid(), 'manual_transfer')
    RETURNING id INTO v_move_id;

  RETURN v_move_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_or_create_wh_item(p_warehouse_id uuid, p_name text, p_unit text DEFAULT 'كجم'::text, p_category text DEFAULT NULL::text, p_module text DEFAULT NULL::text, p_product_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  -- Signed-in callers must hold a screen role. A trigger on the stack,
  -- and a caller with no auth.uid() (service_role or the database owner),
  -- keeps working. request.jwt.claim.role is not a bypass.
  IF pg_trigger_depth() = 0
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::public.app_role,
      'executive_manager'::public.app_role,
      'warehouse_supervisor'::public.app_role,
      'agouza_warehouse_keeper'::public.app_role,
      'production_manager'::public.app_role,
      'meat_factory_manager'::public.app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: إنشاء بطاقة المخزن للمدير أو مسؤول المخزن';
  END IF;

  PERFORM set_config('app.inventory_stock_write', 'on', true);
  v_id := public.resolve_wh_item_by_name(p_warehouse_id, p_name);
  IF v_id IS NOT NULL THEN
    UPDATE public.inventory_items
       SET is_active = true,
           product_id = COALESCE(product_id, p_product_id),
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.inventory_items(warehouse_id, name, unit, category, module, product_id, stock)
  VALUES (p_warehouse_id, btrim(p_name), COALESCE(p_unit,'كجم'), p_category, p_module, p_product_id, 0)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_brooding_feed_row(_feed_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid;
BEGIN
  -- Signed-in callers must hold a screen role. A trigger on the stack,
  -- and a caller with no auth.uid() (service_role or the database owner),
  -- keeps working. request.jwt.claim.role is not a bypass.
  IF pg_trigger_depth() = 0
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::public.app_role,
      'executive_manager'::public.app_role,
      'feed_factory_manager'::public.app_role,
      'brooding_manager'::public.app_role,
      'production_manager'::public.app_role,
      'warehouse_supervisor'::public.app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: صف علف التحضين لمدير العلف أو التحضين أو المدير';
  END IF;

  SELECT id INTO _id FROM brooding_feed_inventory WHERE feed_name = _feed_name;
  IF _id IS NULL THEN
    INSERT INTO brooding_feed_inventory(feed_name, current_kg, last_unit_cost) VALUES (_feed_name, 0, 0)
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END; $function$;

CREATE OR REPLACE FUNCTION public.ensure_slaughter_feed_row(_feed_product_id uuid, _feed_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid;
BEGIN
  -- Signed-in callers must hold a screen role. A trigger on the stack,
  -- and a caller with no auth.uid() (service_role or the database owner),
  -- keeps working. request.jwt.claim.role is not a bypass.
  IF pg_trigger_depth() = 0
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::public.app_role,
      'executive_manager'::public.app_role,
      'feed_factory_manager'::public.app_role,
      'slaughterhouse_manager'::public.app_role,
      'production_manager'::public.app_role,
      'warehouse_supervisor'::public.app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: صف علف المجزر لمدير العلف أو المجزر أو المدير';
  END IF;

  SELECT id INTO _id FROM slaughterhouse_feed_inventory WHERE feed_product_id = _feed_product_id;
  IF _id IS NULL THEN
    INSERT INTO slaughterhouse_feed_inventory(feed_product_id, feed_name, current_kg, last_unit_cost)
    VALUES (_feed_product_id, _feed_name, 0, 0)
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END; $function$;

CREATE OR REPLACE FUNCTION public.ensure_slaughter_feed_raw_row(_raw_material_id uuid, _name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid;
BEGIN
  -- Signed-in callers must hold a screen role. A trigger on the stack,
  -- and a caller with no auth.uid() (service_role or the database owner),
  -- keeps working. request.jwt.claim.role is not a bypass.
  IF pg_trigger_depth() = 0
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::public.app_role,
      'executive_manager'::public.app_role,
      'feed_factory_manager'::public.app_role,
      'slaughterhouse_manager'::public.app_role,
      'production_manager'::public.app_role,
      'warehouse_supervisor'::public.app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: صف علف المجزر لمدير العلف أو المجزر أو المدير';
  END IF;

  SELECT id INTO _id FROM slaughterhouse_feed_inventory WHERE raw_material_id = _raw_material_id;
  IF _id IS NULL THEN
    INSERT INTO slaughterhouse_feed_inventory(raw_material_id, feed_name, current_kg, last_unit_cost)
    VALUES (_raw_material_id, _name, 0, 0)
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END; $function$;

REVOKE ALL ON FUNCTION public.approve_distribution_dispatch(uuid, uuid, uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_distribution_dispatch(uuid, uuid, uuid[], text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meat_production_transfer_to_main(uuid, numeric, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_meat_production(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_between_sublocations(uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_or_create_wh_item(uuid, text, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_brooding_feed_row(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_slaughter_feed_row(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_slaughter_feed_raw_row(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.approve_distribution_dispatch(uuid, uuid, uuid[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_distribution_dispatch(uuid, uuid, uuid[], text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meat_production_transfer_to_main(uuid, numeric, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_meat_production(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_between_sublocations(uuid, uuid, uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_or_create_wh_item(uuid, text, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_brooding_feed_row(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_slaughter_feed_row(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_slaughter_feed_raw_row(uuid, text) TO authenticated, service_role;

-- No page calls this. Order-delivery SQL calls it as the function owner.
REVOKE ALL ON FUNCTION public.is_manual_stock_warehouse(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_manual_stock_warehouse(uuid) TO authenticated, service_role;

-- Explicit public price grant. Default-privilege changes are not retroactive.
GRANT EXECUTE ON FUNCTION public.product_sale_price(uuid) TO anon, authenticated, service_role;
