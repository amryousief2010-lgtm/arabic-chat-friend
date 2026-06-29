
-- ============ 1) Audit log ============
CREATE TABLE IF NOT EXISTS public.agouza_reservation_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  inventory_item_id uuid,
  product_id uuid,
  quantity numeric(14,3),
  action text NOT NULL, -- reserve | release | commit | failure
  status_before text,
  status_after text,
  reason text,
  acted_by uuid DEFAULT auth.uid(),
  acted_at timestamptz NOT NULL DEFAULT now(),
  details jsonb
);

GRANT SELECT, INSERT ON public.agouza_reservation_audit_log TO authenticated;
GRANT ALL ON public.agouza_reservation_audit_log TO service_role;

ALTER TABLE public.agouza_reservation_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agouza_resv_audit_read"
  ON public.agouza_reservation_audit_log FOR SELECT TO authenticated
  USING (public.can_approve_agouza(auth.uid()) OR public.is_agouza_keeper(auth.uid()));

CREATE POLICY "agouza_resv_audit_insert"
  ON public.agouza_reservation_audit_log FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_agouza_resv_audit_order ON public.agouza_reservation_audit_log(order_id);

-- ============ 2) reserve_agouza_stock_for_order ============
CREATE OR REPLACE FUNCTION public.reserve_agouza_stock_for_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agouza_wh constant uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
  v_src uuid;
  v_shortages jsonb := '[]'::jsonb;
  v_reserved jsonb := '[]'::jsonb;
  r record;
  v_item_id uuid;
  v_available numeric;
  v_active_resv numeric;
BEGIN
  IF NOT (public.can_manage_agouza(auth.uid()) OR public.can_approve_agouza(auth.uid())) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  SELECT source_warehouse_id INTO v_src FROM public.orders WHERE id = p_order_id;
  IF v_src IS NULL OR v_src <> v_agouza_wh THEN
    RAISE EXCEPTION 'هذا الأوردر ليس تابعاً لمخزن العجوزة';
  END IF;

  -- Iterate order items (skip gifts? keep them — they still consume stock)
  FOR r IN
    SELECT oi.id AS order_item_id, oi.product_id, SUM(oi.quantity)::numeric AS qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL
    GROUP BY oi.id, oi.product_id
  LOOP
    SELECT id INTO v_item_id
    FROM public.inventory_items
    WHERE warehouse_id = v_agouza_wh AND product_id = r.product_id AND is_active = true
    LIMIT 1;

    IF v_item_id IS NULL THEN
      v_shortages := v_shortages || jsonb_build_object(
        'product_id', r.product_id, 'requested', r.qty, 'reason', 'الصنف غير موجود في مخزن العجوزة'
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(quantity),0) INTO v_active_resv
    FROM public.agouza_stock_reservations
    WHERE inventory_item_id = v_item_id AND status='active' AND order_id <> p_order_id;

    SELECT (stock - v_active_resv) INTO v_available
    FROM public.inventory_items WHERE id = v_item_id;

    IF v_available < r.qty THEN
      v_shortages := v_shortages || jsonb_build_object(
        'product_id', r.product_id, 'inventory_item_id', v_item_id,
        'requested', r.qty, 'available', v_available,
        'shortage', (r.qty - v_available)
      );
    ELSE
      v_reserved := v_reserved || jsonb_build_object(
        'inventory_item_id', v_item_id, 'product_id', r.product_id, 'quantity', r.qty
      );
    END IF;
  END LOOP;

  -- If any shortage -> abort, log failure, no reservations
  IF jsonb_array_length(v_shortages) > 0 THEN
    INSERT INTO public.agouza_reservation_audit_log(order_id, action, reason, details)
    VALUES (p_order_id, 'failure', 'shortage', jsonb_build_object('shortages', v_shortages));
    RETURN jsonb_build_object('ok', false, 'shortages', v_shortages);
  END IF;

  -- Insert reservations (idempotent via unique index)
  FOR r IN SELECT * FROM jsonb_array_elements(v_reserved) AS x(j)
  LOOP
    INSERT INTO public.agouza_stock_reservations(
      order_id, inventory_item_id, product_id, quantity, status, reserved_by
    ) VALUES (
      p_order_id,
      (r.j->>'inventory_item_id')::uuid,
      (r.j->>'product_id')::uuid,
      (r.j->>'quantity')::numeric,
      'active',
      auth.uid()
    )
    ON CONFLICT (order_id, inventory_item_id) WHERE status='active' DO NOTHING;

    INSERT INTO public.agouza_reservation_audit_log(
      order_id, inventory_item_id, product_id, quantity, action, status_after
    ) VALUES (
      p_order_id, (r.j->>'inventory_item_id')::uuid, (r.j->>'product_id')::uuid,
      (r.j->>'quantity')::numeric, 'reserve', 'active'
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reserved', v_reserved);
END;
$$;

-- ============ 3) release_agouza_stock_reservation ============
CREATE OR REPLACE FUNCTION public.release_agouza_stock_reservation(p_order_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  r record;
BEGIN
  IF NOT (public.can_manage_agouza(auth.uid()) OR public.can_approve_agouza(auth.uid())) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  FOR r IN
    SELECT id, inventory_item_id, product_id, quantity
    FROM public.agouza_stock_reservations
    WHERE order_id = p_order_id AND status='active'
  LOOP
    UPDATE public.agouza_stock_reservations
    SET status='released', released_at=now(), released_by=auth.uid(), release_reason=p_reason
    WHERE id = r.id;

    INSERT INTO public.agouza_reservation_audit_log(
      order_id, inventory_item_id, product_id, quantity, action, status_before, status_after, reason
    ) VALUES (
      p_order_id, r.inventory_item_id, r.product_id, r.quantity, 'release', 'active', 'released', p_reason
    );
  END LOOP;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'released_count', v_count);
END;
$$;

-- ============ 4) commit_agouza_stock_on_delivery ============
CREATE OR REPLACE FUNCTION public.commit_agouza_stock_on_delivery(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agouza_wh constant uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
  r record;
  v_mov_id uuid;
  v_committed int := 0;
  v_skipped int := 0;
  v_cost numeric;
BEGIN
  IF NOT (public.can_manage_agouza(auth.uid()) OR public.can_approve_agouza(auth.uid())) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  FOR r IN
    SELECT res.id, res.inventory_item_id, res.product_id, res.quantity,
           ii.stock, ii.unit_cost
    FROM public.agouza_stock_reservations res
    JOIN public.inventory_items ii ON ii.id = res.inventory_item_id
    WHERE res.order_id = p_order_id AND res.status='active'
    FOR UPDATE OF res
  LOOP
    -- Guard: if already committed (defensive — status filter already covers it)
    IF EXISTS (
      SELECT 1 FROM public.agouza_stock_reservations
      WHERE id = r.id AND status='committed'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF r.stock < r.quantity THEN
      INSERT INTO public.agouza_reservation_audit_log(
        order_id, inventory_item_id, product_id, quantity, action, reason, details
      ) VALUES (
        p_order_id, r.inventory_item_id, r.product_id, r.quantity, 'failure',
        'insufficient stock at commit',
        jsonb_build_object('stock', r.stock, 'required', r.quantity)
      );
      RAISE EXCEPTION 'رصيد غير كافٍ عند التنفيذ للصنف %', r.inventory_item_id;
    END IF;

    v_cost := COALESCE(r.unit_cost, 0);

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity,
      reference, reference_type, reference_id, module,
      unit_cost, total_cost, performed_by, product_id, approval_status
    ) VALUES (
      r.inventory_item_id, v_agouza_wh, 'sales_dispatch', r.quantity,
      'Agouza order delivery', 'order', p_order_id::text, 'agouza_warehouse',
      v_cost, v_cost * r.quantity, auth.uid(), r.product_id, 'posted'
    )
    RETURNING id INTO v_mov_id;

    UPDATE public.inventory_items
    SET stock = stock - r.quantity, last_movement_date = now()
    WHERE id = r.inventory_item_id;

    UPDATE public.agouza_stock_reservations
    SET status='committed', committed_at=now(), committed_movement_id=v_mov_id
    WHERE id = r.id;

    INSERT INTO public.agouza_reservation_audit_log(
      order_id, inventory_item_id, product_id, quantity, action, status_before, status_after, details
    ) VALUES (
      p_order_id, r.inventory_item_id, r.product_id, r.quantity, 'commit', 'active', 'committed',
      jsonb_build_object('movement_id', v_mov_id, 'unit_cost', v_cost)
    );

    v_committed := v_committed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'committed', v_committed, 'skipped', v_skipped);
END;
$$;

-- ============ 5) Read-only status helper ============
CREATE OR REPLACE FUNCTION public.get_agouza_order_reservation_status(p_order_id uuid)
RETURNS TABLE (
  product_id uuid,
  inventory_item_id uuid,
  requested numeric,
  reserved numeric,
  stock numeric,
  available numeric,
  shortage numeric,
  reservation_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agouza_wh constant uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
BEGIN
  RETURN QUERY
  WITH req AS (
    SELECT oi.product_id, SUM(oi.quantity)::numeric AS qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id
  ),
  inv AS (
    SELECT ii.product_id, ii.id AS inventory_item_id, ii.stock
    FROM public.inventory_items ii
    WHERE ii.warehouse_id = v_agouza_wh AND ii.is_active = true
  ),
  resv AS (
    SELECT r.product_id, r.inventory_item_id,
           SUM(CASE WHEN r.order_id = p_order_id AND r.status='active' THEN r.quantity ELSE 0 END) AS my_reserved,
           SUM(CASE WHEN r.order_id <> p_order_id AND r.status='active' THEN r.quantity ELSE 0 END) AS other_reserved,
           MAX(CASE WHEN r.order_id = p_order_id THEN r.status END) AS my_status
    FROM public.agouza_stock_reservations r
    GROUP BY r.product_id, r.inventory_item_id
  )
  SELECT req.product_id,
         inv.inventory_item_id,
         req.qty AS requested,
         COALESCE(resv.my_reserved, 0) AS reserved,
         COALESCE(inv.stock, 0) AS stock,
         (COALESCE(inv.stock,0) - COALESCE(resv.other_reserved,0)) AS available,
         GREATEST(req.qty - (COALESCE(inv.stock,0) - COALESCE(resv.other_reserved,0)), 0) AS shortage,
         COALESCE(resv.my_status, 'none') AS reservation_status
  FROM req
  LEFT JOIN inv ON inv.product_id = req.product_id
  LEFT JOIN resv ON resv.inventory_item_id = inv.inventory_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_agouza_stock_for_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_agouza_stock_reservation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_agouza_stock_on_delivery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agouza_order_reservation_status(uuid) TO authenticated;
