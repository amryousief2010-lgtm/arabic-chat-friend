-- Close residual double-counting, cost exposure, and meat-raw stock writes.
-- inventory_items.stock still changes only inside the ledger.
-- A bridge inserter (legacy INSERT into inventory_movements) cannot also assign stock.

CREATE OR REPLACE FUNCTION public.reject_direct_inventory_stock_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.stock, 0) = 0 THEN
      RETURN NEW;
    END IF;
    IF COALESCE(current_setting('app.inventory_stock_write', true), '') = 'on'
       AND COALESCE(current_setting('app.inventory_bridge_insert', true), '') <> 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'لا يمكن إنشاء بطاقة برصيد غير صفري. الرصيد يدخل بحركة عبر post_inventory_movement.';
  END IF;

  IF NEW.stock IS NOT DISTINCT FROM OLD.stock THEN
    RETURN NEW;
  END IF;

  -- Legacy inserters set app.inventory_bridge_insert. The apply trigger is the
  -- only stock writer allowed in that transaction, and only while it runs.
  IF COALESCE(current_setting('app.inventory_bridge_insert', true), '') = 'on'
     AND COALESCE(current_setting('app.inventory_apply_stock', true), '') <> 'on' THEN
    RAISE EXCEPTION
      'DOUBLE_COUNT: دالة التوافق تدرج حركة ولا يجوز أن تعدّل الرصيد معها. استخدم post_inventory_movement';
  END IF;

  IF COALESCE(current_setting('app.inventory_stock_write', true), '') = 'on'
     OR COALESCE(current_setting('app.inventory_apply_stock', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'لا يمكن تعديل رصيد الصنف مباشرة. الرصيد يتغير فقط عبر حركات المخزون.';
END;
$$;

DROP TRIGGER IF EXISTS trg_00_reject_direct_inventory_stock_insert ON public.inventory_items;
CREATE TRIGGER trg_00_reject_direct_inventory_stock_insert
BEFORE INSERT ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.reject_direct_inventory_stock_write();

CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_old_cost numeric;
  v_new_cost numeric;
  v_reserved numeric;
  v_blocked numeric;
  v_allow_neg boolean := false;
  v_mode text;
  v_avail numeric;
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'posted' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(current_setting('app.inventory_ledger_posted', true), '') = 'on'
     AND NEW.stock_before IS NOT NULL
     AND NEW.stock_after IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- apply_stock is on only while this trigger updates the balance.
  -- It is cleared before return so a bridge inserter cannot assign stock afterwards.
  PERFORM set_config('app.inventory_apply_stock', 'on', true);
  PERFORM set_config('app.inventory_stock_write', 'on', true);

  BEGIN
    v_allow_neg := COALESCE(current_setting('app.allow_negative_stock', true), 'off') = 'on';
  EXCEPTION WHEN OTHERS THEN
    v_allow_neg := false;
  END;

  SELECT stock, unit_cost, COALESCE(reserved_qty, 0), COALESCE(blocked_qty, 0)
    INTO v_before, v_old_cost, v_reserved, v_blocked
  FROM public.inventory_items
  WHERE id = NEW.item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود';
  END IF;

  v_mode := NULLIF(btrim(COALESCE(NEW.effect_mode, '')), '');

  IF NEW.movement_type IN ('adjustment', 'reconciliation', 'adjust') AND v_mode = 'delta' THEN
    v_after := COALESCE(v_before, 0) + COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after, last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSIF NEW.movement_type IN ('adjustment', 'reconciliation', 'adjust') THEN
    v_after := COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after, last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSIF NEW.movement_type = 'opening_balance' AND v_mode = 'set' THEN
    v_after := COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after,
           unit_cost = CASE
             WHEN NEW.unit_cost IS NOT NULL AND NEW.unit_cost > 0 THEN NEW.unit_cost
             ELSE unit_cost
           END,
           last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSIF NEW.movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return','opening_balance','sales_return') THEN
    v_after := COALESCE(v_before, 0) + COALESCE(NEW.quantity, 0);
    IF NEW.unit_cost IS NOT NULL AND NEW.unit_cost > 0 AND COALESCE(NEW.quantity, 0) > 0 THEN
      v_new_cost := ((COALESCE(v_before, 0) * COALESCE(v_old_cost, 0)) + (NEW.quantity * NEW.unit_cost))
                    / NULLIF(COALESCE(v_before, 0) + NEW.quantity, 0);
      UPDATE public.inventory_items
         SET stock = v_after,
             unit_cost = COALESCE(v_new_cost, unit_cost),
             last_movement_date = now()
       WHERE id = NEW.item_id;
      IF v_old_cost IS DISTINCT FROM v_new_cost THEN
        INSERT INTO public.product_cost_history(module, target_table, target_id, old_cost, new_cost, reason, source, approved_by)
        VALUES (COALESCE(NEW.module, 'shared'), 'inventory_items', NEW.item_id::text,
                v_old_cost, v_new_cost, 'متوسط مرجح عند ' || NEW.movement_type, 'inv_post', NEW.performed_by);
      END IF;
    ELSE
      UPDATE public.inventory_items
         SET stock = v_after, last_movement_date = now()
       WHERE id = NEW.item_id;
    END IF;

  ELSIF NEW.movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss','transfer','sales_dispatch') THEN
    v_avail := COALESCE(v_before, 0) - v_reserved - v_blocked;
    IF v_avail < COALESCE(NEW.quantity, 0) AND NOT v_allow_neg THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_avail, NEW.quantity;
    END IF;
    v_after := COALESCE(v_before, 0) - COALESCE(NEW.quantity, 0);
    UPDATE public.inventory_items
       SET stock = v_after, last_movement_date = now()
     WHERE id = NEW.item_id;

  ELSE
    v_after := v_before;
  END IF;

  PERFORM set_config('app.inventory_apply_stock', 'off', true);
  PERFORM set_config('app.inventory_movement_snapshot', 'on', true);
  UPDATE public.inventory_movements
     SET stock_before = v_before,
         stock_after = v_after,
         effect_mode = COALESCE(
           NEW.effect_mode,
           CASE
             WHEN NEW.movement_type IN ('adjustment', 'reconciliation', 'adjust') THEN 'set'
             ELSE 'delta'
           END
         )
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;


-- Card merge consolidates balances without a second movement. The statements
-- that assign stock live only in this ledger helper.
CREATE OR REPLACE FUNCTION public.ledger_apply_card_stock(p_item_id uuid, p_stock numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.inventory_stock_write', 'on', true);
  UPDATE public.inventory_items
     SET stock = COALESCE(p_stock, 0),
         last_movement_date = now()
   WHERE id = p_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_apply_card_stock(uuid, numeric) FROM PUBLIC, anon, authenticated;

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

  FOR g IN SELECT * FROM public.report_duplicate_inventory_cards() LOOP
    SELECT stock INTO v_can_stock FROM public.inventory_items WHERE id = g.canonical_id FOR UPDATE;
    FOREACH v_dup IN ARRAY g.card_ids LOOP
      IF v_dup = g.canonical_id THEN CONTINUE; END IF;
      SELECT stock INTO v_dup_stock FROM public.inventory_items WHERE id = v_dup FOR UPDATE;
      UPDATE public.inventory_movements SET item_id = g.canonical_id WHERE item_id = v_dup;
      PERFORM public.ledger_apply_card_stock(
        g.canonical_id,
        COALESCE((SELECT stock FROM public.inventory_items WHERE id = g.canonical_id), 0)
          + COALESCE(v_dup_stock, 0)
      );
      PERFORM public.ledger_apply_card_stock(v_dup, 0);
      UPDATE public.inventory_items
         SET is_active = false,
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


CREATE OR REPLACE FUNCTION public.merge_inventory_items(p_source uuid, p_canonical uuid, p_ref text DEFAULT 'AUTO-MERGE'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.inventory_items%ROWTYPE;
  c public.inventory_items%ROWTYPE;
  v_moved int := 0;
BEGIN
  PERFORM set_config('app.inventory_ledger_relink', 'on', true);
  IF p_source = p_canonical THEN RETURN; END IF;
  SELECT * INTO s FROM public.inventory_items WHERE id = p_source;
  SELECT * INTO c FROM public.inventory_items WHERE id = p_canonical;
  IF s.id IS NULL OR c.id IS NULL THEN RETURN; END IF;
  IF s.warehouse_id <> c.warehouse_id THEN
    RAISE EXCEPTION 'لا يمكن الدمج بين مخازن مختلفة';
  END IF;

  UPDATE public.inventory_movements SET item_id = c.id WHERE item_id = s.id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  UPDATE public.slaughter_batch_outputs SET received_inventory_item_id = c.id WHERE received_inventory_item_id = s.id;
  UPDATE public.warehouse_transfer_items SET source_item_id = c.id WHERE source_item_id = s.id;
  UPDATE public.warehouse_transfer_items SET destination_item_id = c.id WHERE destination_item_id = s.id;
  UPDATE public.meat_factory_raw_materials SET inventory_item_id = c.id WHERE inventory_item_id = s.id;
  UPDATE public.feed_raw_materials SET inventory_item_id = c.id WHERE inventory_item_id = s.id;
  UPDATE public.packaging_materials SET inventory_item_id = c.id WHERE inventory_item_id = s.id;
  UPDATE public.meat_factory_products SET inventory_item_id = c.id WHERE inventory_item_id = s.id;
  UPDATE public.feed_products SET inventory_item_id = c.id WHERE inventory_item_id = s.id;
  UPDATE public.meat_manufacturing_invoices SET finished_item_id = c.id WHERE finished_item_id = s.id;
  UPDATE public.stocktaking_lines SET item_id = c.id WHERE item_id = s.id;

  PERFORM public.ledger_apply_card_stock(c.id, COALESCE(c.stock,0) + COALESCE(s.stock,0));
  UPDATE public.inventory_items
     SET reserved_qty = COALESCE(c.reserved_qty,0) + COALESCE(s.reserved_qty,0),
         product_id = COALESCE(c.product_id, s.product_id),
         updated_at = now()
   WHERE id = c.id;

  PERFORM public.ledger_apply_card_stock(s.id, 0);
  UPDATE public.inventory_items
     SET reserved_qty = 0, blocked_qty = 0, is_active = false,
         product_id = NULL,
         name = s.name || ' (مدمج)',
         notes = COALESCE(s.notes,'') || ' [مدمج في ' || c.name || ']',
         updated_at = now()
   WHERE id = s.id;

  INSERT INTO public.inventory_item_merge_log(
    merge_ref, canonical_item_id, source_item_id, source_name, canonical_name,
    source_stock_before, canonical_stock_before, canonical_stock_after, moved_movements)
  VALUES (p_ref, c.id, s.id, s.name, c.name,
          COALESCE(s.stock,0), COALESCE(c.stock,0), COALESCE(c.stock,0)+COALESCE(s.stock,0), v_moved);
END;
$function$;



-- Manager review sets an absolute balance through the ledger. No direct assignment.
CREATE OR REPLACE FUNCTION public.mr_reconcile_negative_stock(
  p_task_id uuid, p_target_table text, p_target_id text, p_new_stock numeric, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_old numeric; v_task public.data_quality_tasks%ROWTYPE; v_admin boolean;
BEGIN
  v_admin := public.mr_can_admin(auth.uid());
  IF NOT public.mr_can_reconcile_stock(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_task_id IS NULL THEN RAISE EXCEPTION 'TASK_REQUIRED'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF p_new_stock IS NULL THEN RAISE EXCEPTION 'INVALID_VALUE'; END IF;

  SELECT * INTO v_task FROM public.data_quality_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND'; END IF;
  IF v_task.status NOT IN ('open','in_progress') THEN RAISE EXCEPTION 'TASK_NOT_OPEN'; END IF;
  IF v_task.task_type <> 'negative_stock' THEN RAISE EXCEPTION 'TASK_TYPE_MISMATCH'; END IF;
  IF v_task.reference_table IS DISTINCT FROM p_target_table
     OR v_task.reference_id IS DISTINCT FROM p_target_id THEN
    RAISE EXCEPTION 'TARGET_MISMATCH';
  END IF;

  IF NOT v_admin THEN
    IF v_task.module <> 'warehouse' THEN RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_TARGET'; END IF;
    IF p_target_table <> 'inventory_items' THEN RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_TARGET'; END IF;
  END IF;

  IF p_target_table NOT IN ('meat_factory_raw_materials','feed_raw_materials','inventory_items','products') THEN
    RAISE EXCEPTION 'INVALID_TARGET';
  END IF;

  IF p_target_table='meat_factory_raw_materials' THEN
    SELECT stock INTO v_old FROM public.meat_factory_raw_materials WHERE material_code=p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    UPDATE public.meat_factory_raw_materials SET stock=p_new_stock, updated_at=now() WHERE material_code=p_target_id;
  ELSIF p_target_table='feed_raw_materials' THEN
    SELECT stock INTO v_old FROM public.feed_raw_materials WHERE material_code=p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    UPDATE public.feed_raw_materials SET stock=p_new_stock, updated_at=now() WHERE material_code=p_target_id;
  ELSIF p_target_table='inventory_items' THEN
    SELECT stock INTO v_old FROM public.inventory_items WHERE id=p_target_id::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    PERFORM set_config('app.inventory_internal_post', 'on', true);
    PERFORM public.post_inventory_movement(
      p_target_id::uuid, 'adjustment', p_new_stock, 'manual_adjustment',
      p_task_id, 'reconcile', p_reason, p_reason, now(), NULL, 'Manager Review',
      'تسوية مراجعة مدير', 'set', true, NULL, NULL, 'warehouse', NULL, NULL,
      'manual_adjustment', p_target_id, NULL, NULL, NULL, NULL
    );
    PERFORM set_config('app.inventory_internal_post', 'off', true);
  ELSIF p_target_table='products' THEN
    SELECT stock INTO v_old FROM public.products WHERE id=p_target_id::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    UPDATE public.products SET stock=p_new_stock::int, updated_at=now() WHERE id=p_target_id::uuid;
  END IF;

  UPDATE public.data_quality_tasks SET status='resolved', resolved_by=auth.uid(), resolved_at=now(), resolution_notes=p_reason
    WHERE id=p_task_id;

  INSERT INTO public.manager_review_audit(task_id, action, module, target_table, target_id, old_value, new_value, reason, performed_by)
  VALUES (p_task_id, 'reconcile_stock', v_task.module, p_target_table, p_target_id,
          jsonb_build_object('stock', v_old), jsonb_build_object('stock', p_new_stock), p_reason, auth.uid());

  RETURN jsonb_build_object('success', true, 'old', v_old, 'new', p_new_stock);
END
$function$;

REVOKE ALL ON FUNCTION public.mr_reconcile_negative_stock(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mr_reconcile_negative_stock(uuid, text, text, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_receipt_approval(
  p_kind text, p_ref_id uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_ref_no text;
  v_reversed int := 0;
  m record;
  o record;
  t record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT (
    has_role(v_uid, 'general_manager'::app_role)
    OR has_role(v_uid, 'executive_manager'::app_role)
    OR has_role(v_uid, 'warehouse_supervisor'::app_role)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_uid;

  IF p_kind = 'meat_factory' THEN
    SELECT * INTO t FROM public.meat_production_transfers WHERE id = p_ref_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
    IF t.status NOT IN ('received','partial') THEN
      RAISE EXCEPTION 'not_received_yet';
    END IF;
    v_ref_no := t.transfer_no;

    PERFORM set_config('app.inventory_internal_post', 'on', true);
    FOR m IN
      SELECT * FROM public.inventory_movements mv
       WHERE mv.reference_type = 'meat_production_transfer'
         AND mv.reference_id = t.id::text
         AND COALESCE(mv.approval_status, 'posted') = 'posted'
         AND mv.source_type IS DISTINCT FROM 'reversal'
         AND NOT EXISTS (
           SELECT 1 FROM public.inventory_movements r
            WHERE r.source_type = 'reversal'
              AND r.source_id = mv.id
              AND COALESCE(r.approval_status, 'posted') = 'posted'
         )
    LOOP
      IF m.stock_before IS NOT NULL AND m.stock_after IS NOT NULL THEN
        PERFORM public.reverse_posted_inventory_movement(m.id, p_reason);
      ELSIF COALESCE(m.quantity, 0) <> 0 THEN
        PERFORM public.post_inventory_movement(
          m.item_id,
          CASE WHEN m.movement_type IN (
            'out','stock_out','transfer','sales_dispatch','waste_loss',
            'production_consumption','packaging_consumption'
          ) THEN 'in' ELSE 'out' END,
          abs(m.quantity),
          'reversal', m.id, '1', p_reason,
          'عكس اعتماد استلام بدون لقطة',
          now(), m.unit_cost, m.party, m.reference, 'delta', true,
          m.warehouse_id, m.product_id, 'ledger_reversal', m.id, NULL,
          'reversal', m.id::text, NULL, NULL, NULL, NULL
        );
      END IF;
      v_reversed := v_reversed + 1;
    END LOOP;
    PERFORM set_config('app.inventory_internal_post', 'off', true);

    UPDATE public.meat_production_transfers
       SET status = 'received_previously',
           notes = COALESCE(notes,'') || E'\n[عُكس اعتماد الاستلام واعتُبرت موردة سابقًا: ' || p_reason || ']'
     WHERE id = t.id;

  ELSIF p_kind = 'slaughter' THEN
    SELECT batch_number INTO v_ref_no FROM public.slaughter_batches WHERE id = p_ref_id;
    PERFORM set_config('app.inventory_internal_post', 'on', true);
    FOR o IN
      SELECT * FROM public.slaughter_batch_outputs
       WHERE batch_id = p_ref_id AND received_status = 'received'
      FOR UPDATE
    LOOP
      IF o.received_inventory_item_id IS NOT NULL AND COALESCE(o.actual_weight_kg, 0) > 0 THEN
        PERFORM public.post_inventory_movement(
          o.received_inventory_item_id, 'out', o.actual_weight_kg,
          'manual_out', o.id, 'reverse-receipt', p_reason,
          'عكس اعتماد — موردة سابقًا: ' || p_reason,
          now(), COALESCE(o.unit_cost, 0), 'المجزر',
          'عكس استلام دفعة ذبح ' || COALESCE(v_ref_no, ''),
          'delta', true, o.received_warehouse_id, NULL, 'slaughter',
          NULL, NULL, 'manual_out', o.id::text, NULL, NULL, NULL, NULL
        );
      END IF;
      UPDATE public.slaughter_batch_outputs
         SET received_status = 'received_previously',
             received_at = NULL,
             notes = COALESCE(notes,'') || E'\n[عُكس اعتماد الاستلام واعتُبرت موردة سابقًا: ' || p_reason || ']'
       WHERE id = o.id;
      v_reversed := v_reversed + 1;
    END LOOP;
    PERFORM set_config('app.inventory_internal_post', 'off', true);
  ELSE
    RAISE EXCEPTION 'unknown_kind: %', p_kind;
  END IF;

  INSERT INTO public.receipt_disposition_audit(kind, ref_id, ref_no, action, reason, performed_by, performed_by_name)
  VALUES (p_kind, p_ref_id, v_ref_no, 'reversed_approval', p_reason, v_uid, v_name);

  RETURN jsonb_build_object('success', true, 'reversed', v_reversed);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reverse_receipt_approval(text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.receive_meat_production_transfer(_transfer_id uuid, _received_qty numeric DEFAULT NULL::numeric, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t record;
  v_inv_item uuid;
  v_product_name text;
  v_final_qty numeric;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager')
    OR public.has_role(v_uid, 'executive_manager')
    OR public.has_role(v_uid, 'warehouse_supervisor')
    OR public.has_role(v_uid, 'warehouse_manager')
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية اعتماد الوارد';
  END IF;

  SELECT * INTO t FROM meat_production_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF t.status <> 'pending' THEN
    RAISE EXCEPTION 'التحويل ليس بانتظار الاعتماد (الحالة: %)', t.status;
  END IF;

  v_final_qty := COALESCE(_received_qty, t.quantity);
  IF v_final_qty <= 0 THEN RAISE EXCEPTION 'الكمية المستلمة يجب أن تكون أكبر من صفر'; END IF;
  IF v_final_qty > t.quantity THEN
    RAISE EXCEPTION 'الكمية المستلمة (%) أكبر من الكمية المحوّلة (%)', v_final_qty, t.quantity;
  END IF;

  -- If received less than sent, return the difference to factory stock
  IF v_final_qty < t.quantity THEN
    UPDATE meat_factory_products
       SET current_stock = COALESCE(current_stock,0) + (t.quantity - v_final_qty),
           updated_at = now()
     WHERE id = t.product_id;
  END IF;

  SELECT name_ar INTO v_product_name FROM meat_factory_products WHERE id = t.product_id;

  SELECT id INTO v_inv_item FROM inventory_items
    WHERE warehouse_id = t.destination_warehouse_id AND name = v_product_name AND is_active = true
    LIMIT 1;

  IF v_inv_item IS NULL THEN
    INSERT INTO inventory_items (warehouse_id, name, unit, stock, module)
    VALUES (t.destination_warehouse_id, v_product_name, 'كجم', 0, 'meat_factory')
    RETURNING id INTO v_inv_item;
  END IF;

  PERFORM set_config('app.inventory_internal_post', 'on', true);
  PERFORM public.post_inventory_movement(
    v_inv_item, 'in', v_final_qty, 'production', t.id, 'receive',
    'وارد معتمد من مصنع اللحوم', COALESCE(_notes, t.notes), now(), t.unit_cost,
    'مصنع اللحوم', 'وارد معتمد من مصنع اللحوم', 'delta', false,
    t.destination_warehouse_id, NULL, 'meat_factory', NULL, NULL,
    'meat_production_transfer', t.id::text, t.destination_warehouse_id, NULL, NULL, NULL
  );
  PERFORM set_config('app.inventory_internal_post', 'off', true);

  UPDATE meat_production_transfers
    SET status = 'received',
        received_at = now(),
        received_by = v_uid,
        quantity = v_final_qty,
        total_cost = v_final_qty * unit_cost,
        notes = COALESCE(_notes, notes)
    WHERE id = t.id;

  RETURN t.id;
END $function$;


CREATE OR REPLACE FUNCTION public.receive_mf_transfer(p_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  inv RECORD; ln RECORD; dest_item_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_role(v_uid,'general_manager')
    OR public.has_role(v_uid,'executive_manager')
    OR public.has_role(v_uid,'warehouse_supervisor')
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية اعتماد الوارد';
  END IF;

  SELECT * INTO inv FROM mf_transfers WHERE id = p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'أمر نقل غير موجود'; END IF;
  IF inv.status <> 'awaiting_receipt' THEN
    RAISE EXCEPTION 'أمر النقل ليس بانتظار الاستلام (الحالة: %)', inv.status;
  END IF;

  FOR ln IN
    SELECT l.*, f.name_ar AS fname, f.unit AS funit, f.code AS fcode
    FROM mf_transfer_lines l
    JOIN meat_finished_inventory f ON f.id = l.finished_id
    WHERE l.transfer_id = p_id
  LOOP
    SELECT id INTO dest_item_id FROM inventory_items
      WHERE warehouse_id = inv.destination_warehouse_id AND item_code = ln.fcode LIMIT 1;
    IF dest_item_id IS NULL THEN
      INSERT INTO inventory_items(warehouse_id,name,unit,stock,low_stock_threshold,unit_cost,is_active,module,item_code,last_movement_date)
        VALUES(inv.destination_warehouse_id, ln.fname, ln.funit, 0, 0, COALESCE(ln.unit_cost,0), true, 'meat', ln.fcode, now())
        RETURNING id INTO dest_item_id;
    END IF;

    PERFORM set_config('app.inventory_internal_post', 'on', true);
    PERFORM public.post_inventory_movement(
      dest_item_id, 'in', ln.qty, 'transfer_in', inv.id, ln.id::text,
      COALESCE(p_notes, 'استلام معتمد من مصنع اللحوم'),
      COALESCE(p_notes, 'استلام معتمد من مصنع اللحوم'),
      now(), COALESCE(ln.unit_cost, 0), 'مصنع اللحوم', inv.transfer_no, 'delta', false,
      inv.destination_warehouse_id, NULL, 'meat', NULL, NULL,
      'mf_transfers', inv.id::text, NULL, NULL, NULL, NULL
    );
    PERFORM set_config('app.inventory_internal_post', 'off', true);
  END LOOP;

  UPDATE mf_transfers
     SET status = 'posted', posted_at = now(), posted_by = v_uid,
         received_at = now(), received_by = v_uid,
         notes = COALESCE(p_notes, notes), updated_at = now()
   WHERE id = p_id;
END
$function$;



-- Meat-factory raw cards. current_stock moves only inside this function.
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

  RETURN jsonb_build_object(
    'status', 'posted', 'stock_before', v_before, 'stock_after', v_after, 'direction', v_dir, 'quantity', v_qty
  );
EXCEPTION WHEN unique_violation THEN
  IF SQLERRM NOT ILIKE '%meat_raw_moves_source_uidx%'
     AND SQLERRM NOT ILIKE '%uq_meat_moves_%' THEN
    RAISE;
  END IF;
  RETURN jsonb_build_object('status', 'already_posted', 'stock_before', v_before, 'stock_after', v_before);
END;
$function$;

REVOKE ALL ON FUNCTION public.post_meat_raw_movement(
  uuid, text, numeric, numeric, text, text, uuid, text, text, numeric, numeric, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_meat_raw_movement(
  uuid, text, numeric, numeric, text, text, uuid, text, text, numeric, numeric, text
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_direct_meat_raw_stock_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.current_stock, 0) = 0 THEN
      RETURN NEW;
    END IF;
    IF COALESCE(current_setting('app.meat_raw_stock_write', true), '') = 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'لا يمكن إنشاء خامة مصنع برصيد غير صفري. الرصيد يدخل عبر post_meat_raw_movement.';
  END IF;
  IF NEW.current_stock IS NOT DISTINCT FROM OLD.current_stock THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('app.meat_raw_stock_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'لا يمكن تعديل رصيد خامات مصنع اللحوم مباشرة. استخدم post_meat_raw_movement.';
END;
$$;

DROP TRIGGER IF EXISTS trg_00_reject_direct_meat_raw_stock ON public.meat_factory_raw_items;
CREATE TRIGGER trg_00_reject_direct_meat_raw_stock
BEFORE INSERT OR UPDATE OF current_stock ON public.meat_factory_raw_items
FOR EACH ROW
EXECUTE FUNCTION public.reject_direct_meat_raw_stock_write();

CREATE OR REPLACE FUNCTION public.reject_direct_meat_raw_move_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.item_kind = 'finished' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meat_factory_raw_items WHERE id = NEW.item_id) THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('app.meat_raw_stock_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'حركة خامات مصنع اللحوم تُسجّل فقط عبر post_meat_raw_movement';
END;
$$;

DROP TRIGGER IF EXISTS trg_00_reject_direct_meat_raw_move ON public.meat_factory_inventory_moves;
CREATE TRIGGER trg_00_reject_direct_meat_raw_move
BEFORE INSERT ON public.meat_factory_inventory_moves
FOR EACH ROW
EXECUTE FUNCTION public.reject_direct_meat_raw_move_insert();

-- Historical mf moves may repeat (ref, item, direction). Only rows this
-- function marks ledger_keyed are unique. Existing rows stay as they are.
ALTER TABLE public.meat_factory_inventory_moves
  ADD COLUMN IF NOT EXISTS ledger_keyed boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS meat_raw_moves_source_uidx
  ON public.meat_factory_inventory_moves (ref_table, ref_id, item_id, direction)
  WHERE ref_id IS NOT NULL AND item_id IS NOT NULL AND ledger_keyed;

CREATE OR REPLACE FUNCTION public.approve_meat_manufacturing_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.meat_manufacturing_invoices%ROWTYPE;
  v_agg record;
  v_item public.meat_factory_raw_items%ROWTYPE;
  v_finished_item_id uuid;
  v_raw_cost numeric := 0;
  v_spice_cost numeric := 0;
  v_pack_cost numeric := 0;
  v_total numeric := 0;
  v_lines int := 0;
  v_msg text;
  v_existing_move_id uuid;
  v_moves_created int := 0;
  v_moves_skipped int := 0;
  v_finished_existed boolean := false;
BEGIN
  PERFORM set_config('app.inventory_ledger_posted', 'on', true);
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role, 'executive_manager'::app_role,
    'production_manager'::app_role, 'meat_factory_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'الاعتماد متاح للمدير العام أو التنفيذي أو مدير المصنع/الإنتاج فقط';
  END IF;

  SELECT * INTO v_inv FROM public.meat_manufacturing_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;

  IF v_inv.status IN ('approved','transferred') THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_approved', true,
      'message', 'الفاتورة معتمدة بالفعل — لم يتم إعادة التنفيذ',
      'invoice_no', v_inv.invoice_no
    );
  END IF;
  IF v_inv.status IN ('rejected','cancelled') THEN
    RAISE EXCEPTION 'لا يمكن اعتماد فاتورة بحالة %', v_inv.status;
  END IF;

  FOR v_agg IN
    SELECT
      l.item_id,
      COALESCE(MAX(l.kind), 'raw') AS kind,
      MAX(l.item_name) AS item_name,
      SUM(l.quantity) AS quantity,
      CASE WHEN SUM(l.quantity) > 0
           THEN SUM(l.quantity * l.unit_cost) / SUM(l.quantity)
           ELSE 0 END AS unit_cost,
      SUM(l.line_total) AS line_total
    FROM public.meat_manufacturing_invoice_lines l
    WHERE l.invoice_id = p_invoice_id
    GROUP BY l.item_id
  LOOP
    SELECT * INTO v_item FROM public.meat_factory_raw_items WHERE id = v_agg.item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود في مخزن خامات مصنع اللحوم: %', v_agg.item_name; END IF;

    SELECT id INTO v_existing_move_id
      FROM public.meat_factory_inventory_moves
     WHERE ref_table = 'meat_manufacturing_invoices'
       AND ref_id = p_invoice_id
       AND item_id = v_agg.item_id
       AND direction = 'OUT'
     LIMIT 1;

    IF v_existing_move_id IS NULL THEN
      IF v_item.current_stock < v_agg.quantity THEN
        v_msg := format('الرصيد المتاح من الصنف %s غير كافٍ (المتاح %s، المطلوب %s)',
          v_item.name, v_item.current_stock, v_agg.quantity);
        RAISE EXCEPTION '%', v_msg;
      END IF;

      PERFORM public.post_meat_raw_movement(
        v_item.id, 'OUT', v_agg.quantity, v_agg.unit_cost,
        'صرف للتصنيع — ' || v_inv.product_name,
        'meat_manufacturing_invoices', p_invoice_id,
        v_agg.kind, 'delta', NULL, NULL, v_item.name
      );

      v_moves_created := v_moves_created + 1;
    ELSE
      v_moves_skipped := v_moves_skipped + 1;
    END IF;

    UPDATE public.meat_manufacturing_invoice_lines
      SET stock_before = v_item.current_stock,
          stock_after  = v_item.current_stock - v_agg.quantity
      WHERE invoice_id = p_invoice_id AND item_id = v_agg.item_id;

    IF v_agg.kind = 'spice' THEN v_spice_cost := v_spice_cost + v_agg.line_total;
    ELSIF v_agg.kind = 'packaging' THEN v_pack_cost := v_pack_cost + v_agg.line_total;
    ELSE v_raw_cost := v_raw_cost + v_agg.line_total;
    END IF;
    v_total := v_total + v_agg.line_total;
    v_lines := v_lines + 1;
  END LOOP;

  IF v_lines = 0 THEN RAISE EXCEPTION 'لا توجد أصناف في الفاتورة'; END IF;

  v_total := v_total + COALESCE(v_inv.extra_cost, 0);

  -- Finished product item (reuse / create) — canonical-name aware to avoid duplicate cards
  v_finished_item_id := v_inv.finished_item_id;
  IF v_finished_item_id IS NULL THEN
    SELECT id INTO v_finished_item_id
      FROM public.inventory_items
     WHERE warehouse_id = v_inv.factory_warehouse_id
       AND public.canonical_wh_item_name(name) = public.canonical_wh_item_name(v_inv.product_name)
     ORDER BY is_active DESC, COALESCE(stock,0) DESC, created_at ASC
     LIMIT 1;
    IF v_finished_item_id IS NOT NULL THEN
      UPDATE public.inventory_items SET is_active = true, updated_at = now()
       WHERE id = v_finished_item_id AND is_active = false;
    END IF;
    IF v_finished_item_id IS NULL THEN
      INSERT INTO public.inventory_items(name, warehouse_id, category, unit, stock, unit_cost)
      VALUES (v_inv.product_name, v_inv.factory_warehouse_id, 'meat_finished', 'كجم', 0, 0)
      RETURNING id INTO v_finished_item_id;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_movements
     WHERE reference = v_inv.invoice_no
       AND item_id = v_finished_item_id
       AND movement_type = 'in'
  ) THEN
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity, unit_cost, performed_by, notes, reference, party
    ) VALUES (
      v_finished_item_id, v_inv.factory_warehouse_id, 'in', v_inv.finished_qty,
      ROUND(v_total / NULLIF(v_inv.finished_qty,0), 3), v_uid,
      'إنتاج تام من فاتورة تصنيع ' || v_inv.invoice_no,
      v_inv.invoice_no, 'مصنع اللحوم'
    );
  ELSE
    v_finished_existed := true;
  END IF;

  UPDATE public.meat_manufacturing_invoices
    SET status = 'approved',
        approved_by = v_uid, approved_at = now(),
        finished_item_id = v_finished_item_id,
        raw_cost = v_raw_cost, spice_cost = v_spice_cost, packaging_cost = v_pack_cost,
        materials_total_cost = v_raw_cost + v_spice_cost + v_pack_cost,
        total_manufacturing_cost = v_total,
        unit_cost = ROUND(v_total / NULLIF(v_inv.finished_qty,0), 3),
        updated_at = now()
    WHERE id = p_invoice_id;

  INSERT INTO public.meat_factory_audit_log(table_name, row_id, action, new_value, performed_by)
  VALUES ('meat_manufacturing_invoices', p_invoice_id, 'approve',
          jsonb_build_object(
            'product', v_inv.product_name, 'qty', v_inv.finished_qty,
            'raw_cost', v_raw_cost, 'spice_cost', v_spice_cost,
            'packaging_cost', v_pack_cost, 'total', v_total,
            'moves_created', v_moves_created, 'moves_skipped', v_moves_skipped,
            'finished_movement_existed', v_finished_existed
          ),
          v_uid);

  RETURN jsonb_build_object(
    'success', true,
    'invoice_no', v_inv.invoice_no,
    'finished_item_id', v_finished_item_id,
    'raw_cost', v_raw_cost, 'spice_cost', v_spice_cost,
    'packaging_cost', v_pack_cost, 'total_cost', v_total,
    'unit_cost', ROUND(v_total / NULLIF(v_inv.finished_qty,0), 3),
    'moves_created', v_moves_created,
    'moves_skipped', v_moves_skipped,
    'finished_movement_existed', v_finished_existed,
    'message', CASE WHEN v_moves_skipped > 0 OR v_finished_existed
                    THEN 'تم العثور على حركات مخزون سابقة لهذه الفاتورة. تم منع التكرار واستكمال الاعتماد بأمان.'
                    ELSE 'تم اعتماد الفاتورة بنجاح' END
  );
END
$function$;


CREATE OR REPLACE FUNCTION public.cancel_meat_manufacturing_invoice(p_invoice_id uuid, p_reason text, p_force_partial boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.meat_manufacturing_invoices%ROWTYPE;
  v_is_manager boolean;
  v_is_factory_mgr boolean;
  v_move record;
  v_item public.meat_factory_raw_items%ROWTYPE;
  v_fin_stock numeric := 0;
  v_fin_reverse_qty numeric := 0;
  v_partial boolean := false;
  v_reversed_raw int := 0;
  v_carryover_out_reverted int := 0;
  v_carryover_in_reverted int := 0;
  v_before jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  v_is_manager := public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role, 'executive_manager'::app_role
  ]);
  v_is_factory_mgr := public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role, 'executive_manager'::app_role,
    'production_manager'::app_role, 'meat_factory_manager'::app_role
  ]);

  IF NOT v_is_factory_mgr THEN
    RAISE EXCEPTION 'الإلغاء متاح للمدير العام أو التنفيذي أو مدير المصنع/الإنتاج فقط';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'يجب كتابة سبب الإلغاء (٣ أحرف على الأقل)';
  END IF;

  SELECT * INTO v_inv FROM public.meat_manufacturing_invoices
    WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;

  IF v_inv.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'already_cancelled', true,
      'message', 'الفاتورة ملغاة بالفعل');
  END IF;

  IF v_inv.status = 'transferred' THEN
    RAISE EXCEPTION 'لا يمكن إلغاء فاتورة تم تحويل منتجها النهائي إلى مخزن آخر. اعمل تسوية إدارية.';
  END IF;

  v_before := to_jsonb(v_inv);

  -- DRAFT: no inventory effect, just void
  IF v_inv.status = 'draft' THEN
    UPDATE public.meat_manufacturing_invoices
      SET status='cancelled', cancelled_by=v_uid, cancelled_at=now(),
          cancel_reason=p_reason, updated_at=now()
      WHERE id = p_invoice_id;

    INSERT INTO public.meat_factory_audit_log(table_name, row_id, action, old_value, new_value, performed_by)
    VALUES ('meat_manufacturing_invoices', p_invoice_id, 'cancel_draft',
            v_before,
            jsonb_build_object('reason', p_reason, 'inventory_impact', false),
            v_uid);

    RETURN jsonb_build_object('success', true, 'invoice_no', v_inv.invoice_no,
      'message', 'تم إلغاء الفاتورة (لم تكن معتمدة، لا أثر على المخزون)');
  END IF;

  IF v_inv.status <> 'approved' THEN
    RAISE EXCEPTION 'لا يمكن إلغاء فاتورة بحالة %', v_inv.status;
  END IF;

  -- APPROVED: reverse inventory
  -- 2a) Check finished-product availability BEFORE doing any reversals
  IF v_inv.finished_item_id IS NOT NULL AND v_inv.finished_qty > 0 THEN
    SELECT COALESCE(stock,0) INTO v_fin_stock FROM public.inventory_items
      WHERE id = v_inv.finished_item_id FOR UPDATE;

    IF v_fin_stock + 0.0001 < v_inv.finished_qty THEN
      IF NOT (p_force_partial AND v_is_manager) THEN
        RAISE EXCEPTION 'لا يمكن إلغاء الفاتورة لأن المنتج النهائي تم صرفه أو بيعه جزئياً. المتاح: % | المطلوب عكسه: %. يحتاج صلاحية مدير عام/تنفيذي مع إلغاء جزئي.',
          v_fin_stock, v_inv.finished_qty;
      END IF;
      v_partial := true;
      v_fin_reverse_qty := v_fin_stock;
    ELSE
      v_fin_reverse_qty := v_inv.finished_qty;
    END IF;
  END IF;

  -- 2b) Reverse raw/spice/packaging OUT moves with IN reversal moves
  FOR v_move IN
    SELECT * FROM public.meat_factory_inventory_moves
     WHERE ref_table = 'meat_manufacturing_invoices'
       AND ref_id    = p_invoice_id
       AND direction = 'OUT'
       AND COALESCE(reason,'') NOT LIKE '%REVERSAL%'
  LOOP
    -- skip if a reversal already exists for this original move
    IF EXISTS (
      SELECT 1 FROM public.meat_factory_inventory_moves
       WHERE ref_table = 'meat_manufacturing_invoices'
         AND ref_id    = p_invoice_id
         AND item_id   = v_move.item_id
         AND direction = 'IN'
         AND reason LIKE 'REVERSAL%'
    ) THEN CONTINUE; END IF;

    SELECT * INTO v_item FROM public.meat_factory_raw_items
      WHERE id = v_move.item_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    PERFORM public.post_meat_raw_movement(
      v_move.item_id, 'IN', v_move.quantity, v_move.unit_cost,
      'REVERSAL إلغاء فاتورة تصنيع ' || v_inv.invoice_no || ' — ' || p_reason,
      'meat_manufacturing_invoices', p_invoice_id,
      v_move.item_kind, 'delta', NULL, NULL, v_move.item_name
    );

    v_reversed_raw := v_reversed_raw + 1;
  END LOOP;

  -- 2c) Reverse finished-product IN with OUT
  IF v_inv.finished_item_id IS NOT NULL AND v_fin_reverse_qty > 0 THEN
    PERFORM set_config('app.inventory_internal_post', 'on', true);
    PERFORM public.post_inventory_movement(
      v_inv.finished_item_id, 'out', v_fin_reverse_qty, 'production',
      p_invoice_id, 'cancel-finished', p_reason,
      'REVERSAL إلغاء فاتورة تصنيع ' || v_inv.invoice_no
        || CASE WHEN v_partial THEN ' (إلغاء جزئي بصلاحية المدير)' ELSE '' END,
      now(), COALESCE(v_inv.unit_cost, 0), 'مصنع اللحوم', v_inv.invoice_no || '-REV',
      'delta', false, v_inv.factory_warehouse_id, NULL, 'meat', NULL, NULL,
      'production', p_invoice_id::text, NULL, NULL, NULL, NULL
    );
    PERFORM set_config('app.inventory_internal_post', 'off', true);
  END IF;

  -- 2d) Revert carryover_out balances created by this invoice
  WITH upd AS (
    UPDATE public.meat_factory_carryover_dough
      SET status = 'cancelled',
          damaged_by = v_uid,
          damaged_at = now(),
          damaged_reason = 'إلغاء فاتورة التصنيع الأصلية — ' || p_reason,
          updated_at = now()
      WHERE source_invoice_id = p_invoice_id
        AND status <> 'cancelled'
      RETURNING 1
  ) SELECT count(*) INTO v_carryover_out_reverted FROM upd;

  -- 2e) Revert carryover_in usages (restore remaining qty + delete usage rows)
  FOR v_move IN
    SELECT * FROM public.meat_factory_carryover_dough_usage
     WHERE used_in_invoice_id = p_invoice_id
  LOOP
    UPDATE public.meat_factory_carryover_dough
      SET remaining_qty_kg = LEAST(original_qty_kg, COALESCE(remaining_qty_kg,0) + v_move.used_qty_kg),
          status = CASE
            WHEN LEAST(original_qty_kg, COALESCE(remaining_qty_kg,0) + v_move.used_qty_kg)
                 >= original_qty_kg - 0.0001 THEN 'available'
            ELSE 'partial'
          END,
          updated_at = now()
      WHERE id = v_move.carryover_id;

    DELETE FROM public.meat_factory_carryover_dough_usage WHERE id = v_move.id;
    v_carryover_in_reverted := v_carryover_in_reverted + 1;
  END LOOP;

  -- 3) Flip invoice status
  UPDATE public.meat_manufacturing_invoices
    SET status='cancelled',
        cancelled_by=v_uid, cancelled_at=now(),
        cancel_reason=p_reason, updated_at=now()
    WHERE id = p_invoice_id;

  -- 4) Audit
  INSERT INTO public.meat_factory_audit_log(table_name, row_id, action, old_value, new_value, performed_by)
  VALUES ('meat_manufacturing_invoices', p_invoice_id,
          CASE WHEN v_partial THEN 'cancel_partial' ELSE 'cancel' END,
          v_before,
          jsonb_build_object(
            'reason', p_reason,
            'invoice_no', v_inv.invoice_no,
            'product', v_inv.product_name,
            'finished_qty_original', v_inv.finished_qty,
            'finished_qty_reversed', v_fin_reverse_qty,
            'partial', v_partial,
            'raw_moves_reversed', v_reversed_raw,
            'carryover_out_cancelled', v_carryover_out_reverted,
            'carryover_in_reverted', v_carryover_in_reverted,
            'forced_by_manager', p_force_partial AND v_is_manager
          ),
          v_uid);

  RETURN jsonb_build_object(
    'success', true,
    'invoice_no', v_inv.invoice_no,
    'partial', v_partial,
    'raw_moves_reversed', v_reversed_raw,
    'finished_qty_reversed', v_fin_reverse_qty,
    'carryover_out_cancelled', v_carryover_out_reverted,
    'carryover_in_reverted', v_carryover_in_reverted,
    'message', CASE
      WHEN v_partial THEN 'تم إلغاء الفاتورة بشكل جزئي مع عكس الكمية المتاحة من المنتج النهائي'
      ELSE 'تم إلغاء الفاتورة وعكس كامل أثرها على المخزون'
    END
  );
END $function$;


CREATE OR REPLACE FUNCTION public.apply_meat_stocktake(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_s RECORD; v_line RECORD; v_dir TEXT; v_qty NUMERIC; v_cost NUMERIC;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
      OR has_role(auth.uid(),'meat_factory_manager')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  SELECT * INTO v_s FROM meat_factory_stocktaking WHERE id=p_id FOR UPDATE;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'الجرد غير موجود'; END IF;
  IF v_s.status='approved' THEN RAISE EXCEPTION 'الجرد معتمد بالفعل'; END IF;

  FOR v_line IN SELECT * FROM meat_factory_stocktaking_lines WHERE stocktake_id=p_id LOOP
    IF v_line.diff_qty = 0 THEN CONTINUE; END IF;
    v_dir := CASE WHEN v_line.diff_qty>0 THEN 'IN' ELSE 'OUT' END;
    v_qty := ABS(v_line.diff_qty);
    IF v_s.item_kind='raw' THEN
      SELECT avg_cost INTO v_cost FROM meat_factory_raw_items WHERE id=v_line.item_id;
      PERFORM public.post_meat_raw_movement(
        v_line.item_id, v_dir, v_qty, COALESCE(v_cost,0),
        'تسوية جرد', 'meat_factory_stocktaking', p_id,
        'raw', 'set', v_line.actual_qty, NULL, v_line.item_name
      );
    ELSE
      SELECT avg_cost INTO v_cost FROM meat_factory_finished_items WHERE id=v_line.item_id;
      UPDATE meat_factory_finished_items SET current_stock=v_line.actual_qty, updated_at=now() WHERE id=v_line.item_id;
      INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
        VALUES(v_s.item_kind,v_line.item_id,v_line.item_name,v_dir,v_qty,COALESCE(v_cost,0),'تسوية جرد','meat_factory_stocktaking',p_id,auth.uid());
    END IF;
  END LOOP;

  UPDATE meat_factory_stocktaking SET status='approved', approved_at=now(), approved_by=auth.uid() WHERE id=p_id;
  RETURN p_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.approve_meat_manufacturing(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_m RECORD; v_line RECORD; v_pkg RECORD;
  v_total NUMERIC := 0;
  v_old_stock NUMERIC; v_old_cost NUMERIC; v_new_avg NUMERIC;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
      OR has_role(auth.uid(),'meat_factory_manager') OR has_role(auth.uid(),'warehouse_supervisor')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  SELECT * INTO v_m FROM meat_factory_manufacturing WHERE id=p_id FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF v_m.status='approved' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;

  -- check raw availability
  FOR v_line IN SELECT * FROM meat_factory_manufacturing_lines WHERE manufacturing_id=p_id LOOP
    SELECT current_stock INTO v_old_stock FROM meat_factory_raw_items WHERE id=v_line.raw_item_id FOR UPDATE;
    IF v_old_stock < v_line.quantity THEN
      RAISE EXCEPTION 'الخامة % غير كافية (المتاح %, المطلوب %)', v_line.raw_item_name, v_old_stock, v_line.quantity;
    END IF;
  END LOOP;

  -- check packaging availability
  FOR v_pkg IN SELECT * FROM meat_factory_manufacturing_packaging_lines WHERE manufacturing_id=p_id LOOP
    SELECT stock INTO v_old_stock FROM packaging_materials WHERE id=v_pkg.packaging_id FOR UPDATE;
    IF v_old_stock IS NULL OR v_old_stock < v_pkg.quantity THEN
      RAISE EXCEPTION 'مادة التغليف % غير كافية (المتاح %, المطلوب %)', v_pkg.packaging_name, COALESCE(v_old_stock,0), v_pkg.quantity;
    END IF;
  END LOOP;

  -- deduct raws & compute cost
  FOR v_line IN SELECT * FROM meat_factory_manufacturing_lines WHERE manufacturing_id=p_id LOOP
    SELECT current_stock, avg_cost INTO v_old_stock, v_old_cost FROM meat_factory_raw_items WHERE id=v_line.raw_item_id;
    UPDATE meat_factory_manufacturing_lines SET unit_cost=v_old_cost, line_total=v_line.quantity*v_old_cost WHERE id=v_line.id;
    v_total := v_total + (v_line.quantity*v_old_cost);
    PERFORM public.post_meat_raw_movement(
      v_line.raw_item_id, 'OUT', v_line.quantity, v_old_cost,
      'استهلاك تصنيع', 'meat_factory_manufacturing', p_id,
      'raw', 'delta', NULL, NULL, v_line.raw_item_name
    );
  END LOOP;

  -- deduct packaging from packaging warehouse & add to cost
  FOR v_pkg IN SELECT * FROM meat_factory_manufacturing_packaging_lines WHERE manufacturing_id=p_id LOOP
    SELECT stock, unit_cost INTO v_old_stock, v_old_cost FROM packaging_materials WHERE id=v_pkg.packaging_id;
    UPDATE meat_factory_manufacturing_packaging_lines
       SET unit_cost=v_old_cost, line_total=v_pkg.quantity*v_old_cost
     WHERE id=v_pkg.id;
    v_total := v_total + (v_pkg.quantity*v_old_cost);
    UPDATE packaging_materials SET stock=v_old_stock-v_pkg.quantity, updated_at=now() WHERE id=v_pkg.packaging_id;
    INSERT INTO packaging_stock_moves(packaging_id,packaging_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
      VALUES(v_pkg.packaging_id,v_pkg.packaging_name,'OUT',v_pkg.quantity,v_old_cost,'استخدام في تصنيع مصنع اللحوم - '||COALESCE(v_m.invoice_number,''),'meat_factory_manufacturing',p_id,auth.uid());
  END LOOP;

  -- add finished product
  SELECT current_stock, avg_cost INTO v_old_stock, v_old_cost FROM meat_factory_finished_items WHERE id=v_m.finished_item_id FOR UPDATE;
  v_new_avg := CASE WHEN (v_old_stock + v_m.produced_qty)=0 THEN (v_total/NULLIF(v_m.produced_qty,0))
                    ELSE ((v_old_stock*v_old_cost)+v_total)/(v_old_stock+v_m.produced_qty) END;
  UPDATE meat_factory_finished_items SET current_stock=v_old_stock+v_m.produced_qty, avg_cost=v_new_avg, updated_at=now()
    WHERE id=v_m.finished_item_id;

  INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
    VALUES('finished',v_m.finished_item_id,v_m.finished_item_name,'IN',v_m.produced_qty, v_total/NULLIF(v_m.produced_qty,0),'إنتاج تصنيع','meat_factory_manufacturing',p_id,auth.uid());

  UPDATE meat_factory_manufacturing
     SET status='approved', approved_at=now(), approved_by=auth.uid(),
         total_cost=v_total, unit_cost=v_total/NULLIF(v_m.produced_qty,0)
   WHERE id=p_id;
  RETURN p_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.approve_meat_purchase(p_purchase_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_p RECORD; v_line RECORD; v_txn uuid; v_new_avg numeric; v_old_stock numeric; v_old_cost numeric; v_kind text;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')) THEN
    RAISE EXCEPTION 'الاعتماد متاح للمدير العام أو المدير التنفيذي فقط';
  END IF;

  SELECT * INTO v_p FROM meat_factory_purchases WHERE id=p_purchase_id FOR UPDATE;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF v_p.status='approved' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;
  IF v_p.status='rejected' OR v_p.status='cancelled' THEN RAISE EXCEPTION 'لا يمكن اعتماد فاتورة مرفوضة أو ملغاة'; END IF;

  IF v_p.invoice_no IS NULL THEN
    UPDATE meat_factory_purchases SET invoice_no = gen_meat_purchase_invoice_no() WHERE id=p_purchase_id;
  END IF;

  FOR v_line IN SELECT * FROM meat_factory_purchase_lines WHERE purchase_id=p_purchase_id LOOP
    SELECT current_stock, avg_cost, kind INTO v_old_stock, v_old_cost, v_kind
      FROM meat_factory_raw_items WHERE id=v_line.raw_item_id FOR UPDATE;
    IF v_old_stock IS NULL THEN RAISE EXCEPTION 'صنف غير موجود في مخزن الخامات: %', v_line.raw_item_name; END IF;

    v_new_avg := CASE WHEN (v_old_stock + v_line.quantity) = 0 THEN v_line.unit_price
                      ELSE ((v_old_stock*v_old_cost)+(v_line.quantity*v_line.unit_price))/(v_old_stock+v_line.quantity) END;

    PERFORM public.post_meat_raw_movement(
      v_line.raw_item_id, 'IN', v_line.quantity, v_line.unit_price,
      'شراء خامات', 'meat_factory_purchases', p_purchase_id,
      COALESCE(v_line.kind, v_kind, 'raw'), 'delta', NULL, v_new_avg, v_line.raw_item_name
    );
  END LOOP;

  IF v_p.payment_method='cash' AND v_p.total_amount>0 THEN
    INSERT INTO meat_factory_treasury_txns(txn_date,direction,amount,reason,ref_table,ref_id,created_by)
      VALUES(v_p.purchase_date,'OUT',v_p.total_amount,'شراء خامات مصنع اللحوم','meat_factory_purchases',p_purchase_id,auth.uid())
      RETURNING id INTO v_txn;
  END IF;

  UPDATE meat_factory_purchases
    SET status='approved', approved_at=now(), approved_by=auth.uid(), treasury_txn_id=v_txn
    WHERE id=p_purchase_id;

  INSERT INTO meat_factory_audit_log(table_name,row_id,action,new_value,performed_by)
    VALUES('meat_factory_purchases', p_purchase_id, 'approve',
           jsonb_build_object('total', v_p.total_amount, 'supplier', v_p.supplier), auth.uid());

  RETURN p_purchase_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.meat_factory_adjust_stock(p_item_kind text, p_item_id uuid, p_actual_qty numeric, p_reason text, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_before numeric;
  v_diff numeric;
  v_dir text;
  v_unit_cost numeric := 0;
  v_name text;
  v_ref text;
BEGIN
  -- Authorization: only GM or Executive Manager
  IF NOT (public.has_role(v_uid, 'general_manager'::app_role)
       OR public.has_role(v_uid, 'executive_manager'::app_role)) THEN
    RAISE EXCEPTION 'غير مصرح: فقط المدير العام أو المدير التنفيذي يمكنه تسوية المخزون';
  END IF;

  IF p_actual_qty IS NULL OR p_actual_qty < 0 THEN
    RAISE EXCEPTION 'الرصيد الفعلي يجب ألا يكون سالبًا';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'سبب التسوية مطلوب';
  END IF;
  IF p_item_kind NOT IN ('raw','spice','packaging','finished') THEN
    RAISE EXCEPTION 'نوع الصنف غير صحيح';
  END IF;

  IF p_item_kind IN ('raw','spice','packaging') THEN
    SELECT current_stock, COALESCE(avg_cost,0), name
      INTO v_before, v_unit_cost, v_name
    FROM public.meat_factory_raw_items
    WHERE id = p_item_id AND kind = p_item_kind;
  ELSE
    SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost, cost_price, 0), COALESCE(name_ar, name_en)
      INTO v_before, v_unit_cost, v_name
    FROM public.meat_factory_products
    WHERE id = p_item_id;
  END IF;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'الصنف غير موجود';
  END IF;

  v_diff := p_actual_qty - v_before;
  v_dir := CASE WHEN v_diff >= 0 THEN 'IN' ELSE 'OUT' END;
  v_ref := 'meat_factory_stock_adjustment_' || p_item_id::text || '_' || extract(epoch from now())::bigint::text;

  IF p_item_kind IN ('raw','spice','packaging') THEN
    PERFORM public.post_meat_raw_movement(
      p_item_id, v_dir, abs(v_diff), v_unit_cost,
      'stock_adjustment: ' || p_reason || COALESCE(' — ' || p_notes, ''),
      'stock_adjustment', gen_random_uuid(),
      p_item_kind, 'set', p_actual_qty, NULL, v_name
    );
  ELSE
    INSERT INTO public.meat_factory_inventory_moves(
      item_kind, item_id, item_name, direction, quantity, unit_cost,
      reason, ref_table, ref_id, created_by, stock_before, stock_after
    ) VALUES (
      p_item_kind, p_item_id, v_name, v_dir, abs(v_diff), v_unit_cost,
      'stock_adjustment: ' || p_reason || COALESCE(' — ' || p_notes, ''),
      'stock_adjustment', NULL, v_uid, v_before, p_actual_qty
    );
    UPDATE public.meat_factory_products
       SET current_stock = p_actual_qty, updated_at = now()
     WHERE id = p_item_id;
  END IF;

  -- Audit
  INSERT INTO public.meat_factory_audit_log(
    table_name, row_id, action, old_value, new_value, performed_by
  ) VALUES (
    CASE WHEN p_item_kind='finished' THEN 'meat_factory_products' ELSE 'meat_factory_raw_items' END,
    p_item_id, 'stock_adjustment',
    jsonb_build_object('stock', v_before, 'name', v_name, 'kind', p_item_kind),
    jsonb_build_object('stock', p_actual_qty, 'diff', v_diff, 'reason', p_reason, 'notes', p_notes, 'reference_id', v_ref),
    v_uid
  );

  RETURN jsonb_build_object(
    'ok', true, 'item_id', p_item_id, 'item_name', v_name, 'kind', p_item_kind,
    'before', v_before, 'after', p_actual_qty, 'diff', v_diff,
    'value_diff', v_diff * v_unit_cost, 'reference_id', v_ref
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.receive_slaughter_output_to_meat_factory(p_output_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out public.slaughter_batch_outputs%ROWTYPE;
  v_uid uuid := auth.uid();
  v_item_id uuid;
  v_old_stock numeric := 0;
  v_old_cost numeric := 0;
  v_new_stock numeric;
  v_new_cost numeric;
  v_qty numeric;
  v_cost numeric;
  v_batch_no text;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'meat_factory_manager'::app_role,
    'warehouse_supervisor'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك باستلام مخرجات المجزر إلى مصنع اللحوم';
  END IF;

  SELECT * INTO v_out FROM public.slaughter_batch_outputs WHERE id = p_output_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTPUT_NOT_FOUND'; END IF;
  IF v_out.destination <> 'meat_factory' THEN
    RAISE EXCEPTION 'INVALID_DESTINATION: المخرج ليس موجها إلى مصنع اللحوم';
  END IF;
  IF v_out.received_status = 'received' THEN
    RAISE EXCEPTION 'ALREADY_RECEIVED: تم تسجيل هذا التحويل إلى مصنع اللحوم من قبل';
  END IF;
  IF v_out.quality_status <> 'accepted' THEN
    -- Just mark received (no stock add) for non-accepted quality
    UPDATE public.slaughter_batch_outputs
      SET received_status = 'received', received_at = now(), received_by = v_uid
      WHERE id = p_output_id;
    RETURN jsonb_build_object('success', true, 'added_to_stock', false, 'reason', 'non_accepted_quality');
  END IF;

  v_qty := COALESCE(v_out.actual_weight_kg, 0);
  v_cost := COALESCE(v_out.unit_cost, 0);

  SELECT batch_number INTO v_batch_no FROM public.slaughter_batches WHERE id = v_out.batch_id;

  -- Upsert raw item by name (kind=raw, unit=kg)
  SELECT id, current_stock, avg_cost INTO v_item_id, v_old_stock, v_old_cost
  FROM public.meat_factory_raw_items
  WHERE name = v_out.cut_name_ar AND kind = 'raw'
  LIMIT 1;

  IF v_item_id IS NULL THEN
    INSERT INTO public.meat_factory_raw_items (name, kind, unit, current_stock, avg_cost, low_stock_threshold)
    VALUES (v_out.cut_name_ar, 'raw', 'كجم', 0, 0, 5)
    RETURNING id, current_stock, avg_cost INTO v_item_id, v_old_stock, v_old_cost;
  END IF;

  -- Weighted-average cost
  IF (v_old_stock + v_qty) > 0 THEN
    v_new_cost := ((v_old_stock * v_old_cost) + (v_qty * v_cost)) / (v_old_stock + v_qty);
  ELSE
    v_new_cost := v_cost;
  END IF;
  v_new_stock := v_old_stock + v_qty;

  PERFORM public.post_meat_raw_movement(
    v_item_id, 'IN', v_qty, v_cost,
    'وارد من المجزر — دفعة ' || COALESCE(v_batch_no, ''),
    'slaughter_batch_outputs', p_output_id,
    'raw', 'delta', NULL, v_new_cost, v_out.cut_name_ar
  );

  -- Mark output received
  UPDATE public.slaughter_batch_outputs
    SET received_status = 'received',
        received_at = now(),
        received_by = v_uid,
        received_warehouse_id = NULL
    WHERE id = p_output_id;

  -- Audit log
  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES
    ('meat_factory_receipt', 'output', p_output_id, v_out.batch_id, v_uid,
     jsonb_build_object('item_id', v_item_id, 'qty', v_qty, 'unit_cost', v_cost,
                        'stock_before', v_old_stock, 'stock_after', v_new_stock),
     'استلام في مصنع اللحوم: ' || v_out.cut_name_ar || ' — ' || v_qty || ' كجم');

  RETURN jsonb_build_object(
    'success', true,
    'added_to_stock', true,
    'item_id', v_item_id,
    'item_name', v_out.cut_name_ar,
    'qty', v_qty,
    'stock_before', v_old_stock,
    'stock_after', v_new_stock,
    'avg_cost', v_new_cost
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_RECEIVED: تم تسجيل هذا التحويل إلى مصنع اللحوم من قبل';
END;
$function$;


-- Stamp the bridge flag on every remaining direct inserter.
-- post_inventory_movement is excluded: it assigns stock itself and must not be treated as a bridge.
DO $inj$
DECLARE
  r record;
  src text;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
      AND p.proname NOT IN (
        'post_inventory_movement',
        'reject_direct_inventory_movement_write',
        'reject_direct_inventory_stock_write'
      )
      AND (
        pg_get_functiondef(p.oid) ILIKE '%INSERT INTO public.inventory_movements%'
        OR pg_get_functiondef(p.oid) ILIKE '%INSERT INTO inventory_movements%'
      )
      AND pg_get_functiondef(p.oid) NOT ILIKE '%app.inventory_bridge_insert%'
  LOOP
    src := r.def;
    IF src NOT ILIKE '%app.inventory_ledger_posted%' THEN
      src := regexp_replace(
        src, 'BEGIN',
        E'BEGIN\n  PERFORM set_config(''app.inventory_ledger_posted'', ''on'', true);',
        1, 1
      );
    END IF;
    src := regexp_replace(
      src, 'BEGIN',
      E'BEGIN\n  PERFORM set_config(''app.inventory_bridge_insert'', ''on'', true);',
      1, 1
    );
    EXECUTE src;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'bridge flag injected into % movement inserters', n;
END
$inj$;

-- products.cost_price stays unreadable. Sale price stays readable.
-- A later GRANT SELECT ON TABLE would re-expose cost; CI checks the privilege.
REVOKE SELECT (cost_price) ON public.products FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (cost_price) ON public.products FROM PUBLIC, anon, authenticated;
GRANT SELECT (price) ON public.products TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.product_sale_price(p_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT price FROM public.products WHERE id = p_product_id;
$$;

CREATE OR REPLACE FUNCTION public.product_cost_price(p_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.can_view_inventory_cost(auth.uid()) THEN COALESCE(
      (SELECT cd.cost_price FROM public.product_cost_data cd WHERE cd.product_id = p_product_id),
      (SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id)
    )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.set_product_cost_price(p_product_id uuid, p_cost numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.can_view_inventory_cost(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: التكلفة للمحاسبين والمديرين فقط';
  END IF;
  IF p_cost IS NOT NULL AND p_cost < 0 THEN
    RAISE EXCEPTION 'INVALID_COST';
  END IF;
  UPDATE public.products SET cost_price = p_cost, updated_at = now() WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.product_sale_price(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_cost_price(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_product_cost_price(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_sale_price(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_cost_price(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_product_cost_price(uuid, numeric) TO authenticated, service_role;

-- Re-assert movement cost columns. Table SELECT stays revoked.
DO $cost$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated']
  LOOP
    IF r = 'PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE SELECT (unit_cost, total_cost) ON public.inventory_movements FROM %s', r);
      EXECUTE format('REVOKE SELECT (unit_cost) ON public.inventory_items FROM %s', r);
      EXECUTE format('REVOKE SELECT (cost_price) ON public.products FROM %s', r);
    END IF;
  END LOOP;
END
$cost$;
