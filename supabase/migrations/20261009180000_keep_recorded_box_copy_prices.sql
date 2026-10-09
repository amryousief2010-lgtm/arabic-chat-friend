-- Keep each box copy on the unit prices stored on its order_items.
-- A merged line (one row for every copy) is split by quantity only.
-- Rows that were already saved separately stay whole, so a later price on
-- copy 2 is not averaged into copy 1, and deleting copy 1 does not rewrite
-- copy 2. Catalog offer_price and products.price are not read here.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public._plan_unlinked_box_copy_lines(
  p_order_id uuid,
  p_offer_name text,
  p_virtual integer[]
) RETURNS TABLE (
  item_id uuid,
  copy_index integer,
  quantity numeric,
  keep_row boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
  v_group record;
  v_item record;
  v_pos integer;
  v_slot integer;
  v_share numeric;
BEGIN
  v_n := coalesce(array_length(p_virtual, 1), 0);
  IF v_n = 0 OR p_offer_name IS NULL OR btrim(p_offer_name) = '' THEN
    RETURN;
  END IF;

  FOR v_group IN
    SELECT
      coalesce(i.product_id::text, i.product_name) AS product_key,
      coalesce(i.is_gift, false) AS is_gift,
      count(*) AS group_n,
      count(DISTINCT i.unit_price) AS price_n
    FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = btrim(p_offer_name)
      AND (
        i.offer_copy_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.order_box_copies c
          WHERE c.id = i.offer_copy_id
            AND c.active
            AND c.offer_name = btrim(p_offer_name)
        )
      )
      AND NOT (
        i.product_id IS NULL
        AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن'
      )
    GROUP BY 1, 2
  LOOP
    v_pos := 0;
    FOR v_item IN
      SELECT i.id, i.quantity
      FROM public.order_items i
      WHERE i.order_id = p_order_id
        AND btrim(coalesce(i.offer_name, '')) = btrim(p_offer_name)
        AND coalesce(i.product_id::text, i.product_name) = v_group.product_key
        AND coalesce(i.is_gift, false) = v_group.is_gift
        AND (
          i.offer_copy_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.order_box_copies c
            WHERE c.id = i.offer_copy_id
              AND c.active
              AND c.offer_name = btrim(p_offer_name)
          )
        )
        AND NOT (
          i.product_id IS NULL
          AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن'
        )
      ORDER BY i.created_at, i.id
    LOOP
      v_pos := v_pos + 1;
      IF v_group.group_n = 1 OR (v_group.price_n = 1 AND v_group.group_n <> v_n) THEN
        FOR v_slot IN 1..v_n LOOP
          v_share := public._box_copy_qty_share(v_item.quantity, v_n, v_slot);
          IF v_share > 0 THEN
            item_id := v_item.id;
            copy_index := p_virtual[v_slot];
            quantity := v_share;
            keep_row := false;
            RETURN NEXT;
          END IF;
        END LOOP;
      ELSE
        IF v_group.group_n = v_n THEN
          v_slot := v_pos;
        ELSE
          v_slot := ((v_pos - 1) % v_n) + 1;
        END IF;
        item_id := v_item.id;
        copy_index := p_virtual[v_slot];
        quantity := v_item.quantity;
        keep_row := true;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._materialize_offer_box_copies(
  p_order_id uuid,
  p_offer_name text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst public.order_offer_instances%ROWTYPE;
  v_active_indexes integer[];
  v_virtual integer[];
  v_slots integer;
  v_active_count integer;
  v_cursor integer;
  v_i integer;
  v_n integer;
  v_plan record;
  v_copy_id uuid;
  v_prev_item uuid;
  v_has_unlinked boolean;
BEGIN
  IF p_offer_name IS NULL OR btrim(p_offer_name) = '' THEN
    RETURN;
  END IF;

  SELECT * INTO v_inst
  FROM public.order_offer_instances
  WHERE order_id = p_order_id AND offer_name = btrim(p_offer_name)
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT coalesce(array_agg(copy_index ORDER BY copy_index), ARRAY[]::integer[])
  INTO v_active_indexes
  FROM public.order_box_copies
  WHERE order_id = p_order_id AND offer_name = btrim(p_offer_name) AND active;

  v_active_count := coalesce(array_length(v_active_indexes, 1), 0);
  v_slots := greatest(0, v_inst.quantity - v_active_count);

  SELECT EXISTS (
    SELECT 1
    FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = btrim(p_offer_name)
      AND (
        i.offer_copy_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.order_box_copies c
          WHERE c.id = i.offer_copy_id AND c.active AND c.offer_name = btrim(p_offer_name)
        )
      )
      AND NOT (
        i.product_id IS NULL
        AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن'
      )
  ) INTO v_has_unlinked;

  IF v_slots = 0 AND v_has_unlinked THEN
    v_slots := 1;
  END IF;

  v_virtual := ARRAY[]::integer[];
  v_cursor := 1;
  WHILE coalesce(array_length(v_virtual, 1), 0) < v_slots LOOP
    IF NOT (v_cursor = ANY (v_active_indexes)) THEN
      v_virtual := array_append(v_virtual, v_cursor);
    END IF;
    v_cursor := v_cursor + 1;
    IF v_cursor > 100000 THEN
      EXIT;
    END IF;
  END LOOP;

  v_n := coalesce(array_length(v_virtual, 1), 0);
  IF v_n = 0 THEN
    RETURN;
  END IF;

  FOREACH v_i IN ARRAY v_virtual LOOP
    INSERT INTO public.order_box_copies (
      order_id, legacy_instance_id, offer_box_id, offer_name, copy_index, recorded_price, active
    )
    SELECT p_order_id, v_inst.id, v_inst.offer_box_id, btrim(p_offer_name), v_i, 0, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.order_box_copies c
      WHERE c.order_id = p_order_id
        AND c.offer_name = btrim(p_offer_name)
        AND c.copy_index = v_i
    );
  END LOOP;

  v_prev_item := NULL;
  FOR v_plan IN
    SELECT *
    FROM public._plan_unlinked_box_copy_lines(p_order_id, btrim(p_offer_name), v_virtual)
    WHERE quantity > 0
    ORDER BY item_id, copy_index
  LOOP
    SELECT c.id INTO v_copy_id
    FROM public.order_box_copies c
    WHERE c.order_id = p_order_id
      AND c.offer_name = btrim(p_offer_name)
      AND c.copy_index = v_plan.copy_index
    LIMIT 1;

    IF v_plan.keep_row THEN
      UPDATE public.order_items
      SET offer_copy_id = v_copy_id,
          offer_name = btrim(p_offer_name)
      WHERE id = v_plan.item_id;
    ELSIF v_prev_item IS DISTINCT FROM v_plan.item_id THEN
      UPDATE public.order_items
      SET quantity = v_plan.quantity,
          total_price = round(v_plan.quantity * unit_price, 2),
          offer_copy_id = v_copy_id,
          offer_name = btrim(p_offer_name)
      WHERE id = v_plan.item_id;
      v_prev_item := v_plan.item_id;
    ELSE
      INSERT INTO public.order_items (
        order_id, product_id, product_name, quantity, unit_price, total_price,
        offer_name, offer_copy_id, is_gift, is_half_kg
      )
      SELECT
        p_order_id, i.product_id, i.product_name, v_plan.quantity, i.unit_price,
        round(v_plan.quantity * i.unit_price, 2), btrim(p_offer_name), v_copy_id,
        coalesce(i.is_gift, false), coalesce(i.is_half_kg, false)
      FROM public.order_items i
      WHERE i.id = v_plan.item_id;
    END IF;
  END LOOP;

  UPDATE public.order_box_copies c
  SET recorded_price = coalesce((
    SELECT round(sum(i.quantity * i.unit_price), 2)
    FROM public.order_items i
    WHERE i.offer_copy_id = c.id
  ), 0)
  WHERE c.order_id = p_order_id
    AND c.offer_name = btrim(p_offer_name)
    AND c.copy_index = ANY (v_virtual);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_order_box_copies(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst record;
  v_copy record;
  v_plan record;
  v_result jsonb := '[]'::jsonb;
  v_seen text[] := ARRAY[]::text[];
  v_name text;
  v_active_ids uuid[];
  v_active_indexes integer[];
  v_virtual integer[];
  v_slots integer;
  v_active_count integer;
  v_cursor integer;
  v_i integer;
  v_n integer;
  v_lines jsonb;
  v_price numeric;
  v_orphan text;
BEGIN
  PERFORM public._assert_box_copy_editor();

  FOR v_inst IN
    SELECT *
    FROM public.order_offer_instances
    WHERE order_id = p_order_id
    ORDER BY offer_name, id
  LOOP
    v_name := btrim(v_inst.offer_name);
    IF v_name = '' OR v_name = ANY (v_seen) THEN
      CONTINUE;
    END IF;
    v_seen := array_append(v_seen, v_name);

    SELECT
      coalesce(array_agg(id ORDER BY copy_index), ARRAY[]::uuid[]),
      coalesce(array_agg(copy_index ORDER BY copy_index), ARRAY[]::integer[])
    INTO v_active_ids, v_active_indexes
    FROM public.order_box_copies
    WHERE order_id = p_order_id AND offer_name = v_name AND active;

    FOR v_copy IN
      SELECT *
      FROM public.order_box_copies
      WHERE order_id = p_order_id AND offer_name = v_name AND active
      ORDER BY copy_index
    LOOP
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'product_id', i.product_id,
        'product_name', i.product_name,
        'quantity', i.quantity,
        'unit_price', i.unit_price,
        'is_gift', coalesce(i.is_gift, false)
      ) ORDER BY i.id), '[]'::jsonb)
      INTO v_lines
      FROM public.order_items i
      WHERE i.offer_copy_id = v_copy.id
        AND NOT (
          i.product_id IS NULL
          AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن'
        );
      SELECT coalesce(round(sum(i.quantity * i.unit_price), 2), 0)
      INTO v_price
      FROM public.order_items i
      WHERE i.offer_copy_id = v_copy.id
        AND NOT (
          i.product_id IS NULL
          AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن'
        );
      v_result := v_result || jsonb_build_object(
        'key', 'copy:' || v_copy.id::text,
        'kind', 'materialized',
        'copy_index', v_copy.copy_index,
        'offer_name', v_name,
        'offer_box_id', coalesce(v_copy.offer_box_id, v_inst.offer_box_id),
        'recorded_price', v_price,
        'lines', v_lines
      );
    END LOOP;

    v_active_count := coalesce(array_length(v_active_indexes, 1), 0);
    v_slots := greatest(0, v_inst.quantity - v_active_count);
    IF v_slots = 0 AND EXISTS (
      SELECT 1 FROM public.order_items i
      WHERE i.order_id = p_order_id
        AND btrim(coalesce(i.offer_name, '')) = v_name
        AND (i.offer_copy_id IS NULL OR NOT (i.offer_copy_id = ANY (v_active_ids)))
        AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن')
    ) THEN
      v_slots := 1;
    END IF;

    v_virtual := ARRAY[]::integer[];
    v_cursor := 1;
    WHILE coalesce(array_length(v_virtual, 1), 0) < v_slots LOOP
      IF NOT (v_cursor = ANY (v_active_indexes)) THEN
        v_virtual := array_append(v_virtual, v_cursor);
      END IF;
      v_cursor := v_cursor + 1;
      IF v_cursor > 100000 THEN
        EXIT;
      END IF;
    END LOOP;

    v_n := coalesce(array_length(v_virtual, 1), 0);
    FOREACH v_i IN ARRAY v_virtual LOOP
      v_lines := '[]'::jsonb;
      v_price := 0;
      FOR v_plan IN
        SELECT p.item_id, p.quantity, i.product_id, i.product_name, i.unit_price, i.is_gift
        FROM public._plan_unlinked_box_copy_lines(p_order_id, v_name, v_virtual) p
        JOIN public.order_items i ON i.id = p.item_id
        WHERE p.copy_index = v_i AND p.quantity > 0
        ORDER BY i.created_at, i.id
      LOOP
        v_lines := v_lines || jsonb_build_object(
          'id', v_plan.item_id,
          'product_id', v_plan.product_id,
          'product_name', v_plan.product_name,
          'quantity', v_plan.quantity,
          'unit_price', v_plan.unit_price,
          'is_gift', coalesce(v_plan.is_gift, false)
        );
        v_price := v_price + (v_plan.quantity * v_plan.unit_price);
      END LOOP;
      v_result := v_result || jsonb_build_object(
        'key', 'inst:' || v_inst.id::text || ':' || v_i::text,
        'kind', 'virtual',
        'copy_index', v_i,
        'offer_name', v_name,
        'offer_box_id', v_inst.offer_box_id,
        'recorded_price', round(v_price, 2),
        'lines', v_lines
      );
    END LOOP;
  END LOOP;

  FOR v_orphan IN
    SELECT DISTINCT btrim(i.offer_name)
    FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) <> ''
      AND NOT (btrim(i.offer_name) = ANY (v_seen))
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن')
    ORDER BY 1
  LOOP
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'product_id', i.product_id,
      'product_name', i.product_name,
      'quantity', i.quantity,
      'unit_price', i.unit_price,
      'is_gift', coalesce(i.is_gift, false)
    ) ORDER BY i.id), '[]'::jsonb),
    coalesce(round(sum(i.quantity * i.unit_price), 2), 0)
    INTO v_lines, v_price
    FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = v_orphan
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن');
    v_result := v_result || jsonb_build_object(
      'key', 'orphan:' || v_orphan,
      'kind', 'orphan',
      'copy_index', 1,
      'offer_name', v_orphan,
      'offer_box_id', NULL,
      'recorded_price', v_price,
      'lines', v_lines
    );
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = ''
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن')
  ) THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'product_id', i.product_id,
      'product_name', i.product_name,
      'quantity', i.quantity,
      'unit_price', i.unit_price,
      'is_gift', coalesce(i.is_gift, false)
    ) ORDER BY i.id), '[]'::jsonb),
    coalesce(round(sum(i.quantity * i.unit_price), 2), 0)
    INTO v_lines, v_price
    FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = ''
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن');
    v_result := v_result || jsonb_build_object(
      'key', 'plain',
      'kind', 'plain',
      'copy_index', 1,
      'offer_name', NULL,
      'offer_box_id', NULL,
      'recorded_price', v_price,
      'lines', v_lines
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public._plan_unlinked_box_copy_lines(uuid, text, integer[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._materialize_offer_box_copies(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_order_box_copies(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_order_box_copies(uuid) TO authenticated, service_role;
