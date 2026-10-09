-- Per-copy identity for offer boxes.
-- order_offer_instances stays one row per (order, offer name). Historical
-- order_items stay unlinked (offer_copy_id NULL) until a copy is changed.
-- Unique (order_id, offer_name) is intentionally kept.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS offer_copy_id uuid;

CREATE TABLE IF NOT EXISTS public.order_box_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  legacy_instance_id uuid REFERENCES public.order_offer_instances(id) ON DELETE SET NULL,
  offer_box_id uuid REFERENCES public.offer_boxes(id) ON DELETE SET NULL,
  offer_name text NOT NULL,
  copy_index integer NOT NULL CHECK (copy_index > 0),
  recorded_price numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, offer_name, copy_index)
);

CREATE INDEX IF NOT EXISTS idx_order_box_copies_active
  ON public.order_box_copies (order_id, offer_name)
  WHERE active;

DO $$ BEGIN
  ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_offer_copy_id_fkey
    FOREIGN KEY (offer_copy_id) REFERENCES public.order_box_copies(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_items_offer_copy_id
  ON public.order_items (offer_copy_id)
  WHERE offer_copy_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.order_box_copy_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  acted_by uuid,
  acted_at timestamptz NOT NULL DEFAULT now(),
  operation text NOT NULL,
  source_key text,
  source_offer_name text,
  source_copy_index integer,
  source_recorded_price numeric,
  removed_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  added_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_delta numeric,
  previous_total numeric,
  new_total numeric,
  result jsonb,
  UNIQUE (order_id, idempotency_key)
);

ALTER TABLE public.order_box_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_box_copy_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_box_copies_select ON public.order_box_copies;
CREATE POLICY order_box_copies_select
ON public.order_box_copies
FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_box_copies.order_id)
);

DROP POLICY IF EXISTS order_box_copy_audit_select ON public.order_box_copy_audit;
CREATE POLICY order_box_copy_audit_select
ON public.order_box_copy_audit
FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_box_copy_audit.order_id)
);

GRANT SELECT ON public.order_box_copies, public.order_box_copy_audit TO authenticated;
GRANT ALL ON public.order_box_copies, public.order_box_copy_audit TO service_role;

-- Equal split. Remainder units (1/10000) stay on the lower copy positions.
CREATE OR REPLACE FUNCTION public._box_copy_qty_share(
  p_total numeric,
  p_copies integer,
  p_index integer
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_milli numeric;
  v_base numeric;
  v_rem numeric;
BEGIN
  IF p_total IS NULL OR p_copies IS NULL OR p_copies <= 0
     OR p_index IS NULL OR p_index < 1 OR p_index > p_copies THEN
    RETURN 0;
  END IF;
  v_milli := round(p_total * 10000);
  v_base := trunc(v_milli / p_copies);
  v_rem := v_milli - (v_base * p_copies);
  IF p_index <= v_rem THEN
    RETURN (v_base + 1) / 10000;
  END IF;
  RETURN v_base / 10000;
END;
$$;

CREATE OR REPLACE FUNCTION public._assert_box_copy_editor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::public.app_role,
    'executive_manager'::public.app_role,
    'sales_manager'::public.app_role,
    'marketing_sales_manager'::public.app_role,
    'sales_moderator'::public.app_role
  ]) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تعديل الطلب';
  END IF;
  RETURN v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public._box_offer_shipping(p_box_id uuid, p_name text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship numeric;
BEGIN
  IF p_box_id IS NOT NULL THEN
    SELECT b.shipping_cost INTO v_ship
    FROM public.offer_boxes b
    WHERE b.id = p_box_id;
    IF FOUND THEN
      RETURN coalesce(v_ship, 0);
    END IF;
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN 0;
  END IF;
  SELECT b.shipping_cost INTO v_ship
  FROM public.offer_boxes b
  WHERE b.name = btrim(p_name)
  ORDER BY b.is_active DESC NULLS LAST, b.created_at DESC NULLS LAST
  LIMIT 1;
  RETURN coalesce(v_ship, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.order_box_snapshot_token(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  PERFORM public._assert_box_copy_editor();
  SELECT md5(
    coalesce(o.updated_at::text, '') || '|' ||
    coalesce((
      SELECT string_agg(
        i.id::text || ':' || i.quantity::text || ':' || i.unit_price::text || ':' ||
        coalesce(i.offer_name, '') || ':' || coalesce(i.offer_copy_id::text, '') || ':' ||
        coalesce(i.product_id::text, ''),
        '|' ORDER BY i.id
      )
      FROM public.order_items i
      WHERE i.order_id = o.id
    ), '') || '|' ||
    coalesce((
      SELECT string_agg(
        inst.id::text || ':' || inst.quantity::text || ':' || inst.offer_name,
        '|' ORDER BY inst.id
      )
      FROM public.order_offer_instances inst
      WHERE inst.order_id = o.id
    ), '') || '|' ||
    coalesce((
      SELECT string_agg(
        c.id::text || ':' || c.copy_index::text || ':' || c.active::text || ':' || c.offer_name,
        '|' ORDER BY c.id
      )
      FROM public.order_box_copies c
      WHERE c.order_id = o.id
    ), '')
  )
  INTO v_token
  FROM public.orders o
  WHERE o.id = p_order_id;
  RETURN coalesce(v_token, '');
END;
$$;

-- Turn virtual copies into rows and split only the still-unlinked lines.
-- Copies that already exist are left alone.
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
  v_pos integer;
  v_n integer;
  v_item record;
  v_share numeric;
  v_copy_id uuid;
  v_first boolean;
  v_price numeric;
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

  FOR v_item IN
    SELECT i.*
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
  LOOP
    v_first := true;
    v_pos := 0;
    FOREACH v_i IN ARRAY v_virtual LOOP
      v_pos := v_pos + 1;
      v_share := public._box_copy_qty_share(v_item.quantity, v_n, v_pos);
      IF v_share <= 0 THEN
        CONTINUE;
      END IF;
      SELECT c.id INTO v_copy_id
      FROM public.order_box_copies c
      WHERE c.order_id = p_order_id
        AND c.offer_name = btrim(p_offer_name)
        AND c.copy_index = v_i
      LIMIT 1;
      v_price := CASE WHEN coalesce(v_item.is_gift, false) THEN 0 ELSE v_item.unit_price END;
      IF v_first THEN
        UPDATE public.order_items
        SET quantity = v_share,
            unit_price = v_price,
            total_price = round(v_share * v_price, 2),
            offer_copy_id = v_copy_id,
            offer_name = btrim(p_offer_name)
        WHERE id = v_item.id;
        v_first := false;
      ELSE
        INSERT INTO public.order_items (
          order_id, product_id, product_name, quantity, unit_price, total_price,
          offer_name, offer_copy_id, is_gift, is_half_kg
        ) VALUES (
          p_order_id, v_item.product_id, v_item.product_name, v_share, v_price,
          round(v_share * v_price, 2), btrim(p_offer_name), v_copy_id,
          coalesce(v_item.is_gift, false), coalesce(v_item.is_half_kg, false)
        );
      END IF;
    END LOOP;
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

CREATE OR REPLACE FUNCTION public._sync_offer_instance_count(
  p_order_id uuid,
  p_offer_name text,
  p_offer_box_id uuid,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active integer;
  v_name text := btrim(coalesce(p_offer_name, ''));
BEGIN
  IF v_name = '' THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_active
  FROM public.order_box_copies
  WHERE order_id = p_order_id AND offer_name = v_name AND active;
  IF coalesce(v_active, 0) = 0 THEN
    DELETE FROM public.order_offer_instances
    WHERE order_id = p_order_id AND offer_name = v_name;
    RETURN;
  END IF;
  UPDATE public.order_offer_instances
  SET quantity = v_active,
      offer_box_id = coalesce(p_offer_box_id, offer_box_id),
      updated_at = now()
  WHERE order_id = p_order_id AND offer_name = v_name;
  IF NOT FOUND THEN
    INSERT INTO public.order_offer_instances (
      order_id, offer_name, offer_box_id, quantity, created_by
    ) VALUES (
      p_order_id, v_name, p_offer_box_id, v_active, p_actor
    );
  END IF;
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
  v_item record;
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
  v_pos integer;
  v_n integer;
  v_lines jsonb;
  v_price numeric;
  v_share numeric;
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
    v_pos := 0;
    FOREACH v_i IN ARRAY v_virtual LOOP
      v_pos := v_pos + 1;
      v_lines := '[]'::jsonb;
      v_price := 0;
      FOR v_item IN
        SELECT i.*
        FROM public.order_items i
        WHERE i.order_id = p_order_id
          AND btrim(coalesce(i.offer_name, '')) = v_name
          AND (i.offer_copy_id IS NULL OR NOT (i.offer_copy_id = ANY (v_active_ids)))
          AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن')
        ORDER BY i.id
      LOOP
        v_share := public._box_copy_qty_share(v_item.quantity, v_n, v_pos);
        IF v_share <= 0 THEN
          CONTINUE;
        END IF;
        v_lines := v_lines || jsonb_build_object(
          'id', v_item.id,
          'product_id', v_item.product_id,
          'product_name', v_item.product_name,
          'quantity', v_share,
          'unit_price', v_item.unit_price,
          'is_gift', coalesce(v_item.is_gift, false)
        );
        v_price := v_price + (v_share * v_item.unit_price);
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

CREATE OR REPLACE FUNCTION public.register_added_order_box_copy(
  p_order_id uuid,
  p_offer_name text,
  p_offer_box_id uuid,
  p_item_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_name text := btrim(coalesce(p_offer_name, ''));
  v_existing integer;
  v_index integer;
  v_id uuid;
  v_price numeric;
BEGIN
  v_uid := public._assert_box_copy_editor();
  IF v_name = '' THEN
    RAISE EXCEPTION 'اسم البوكس مطلوب';
  END IF;
  IF p_item_ids IS NULL OR coalesce(array_length(p_item_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'لا توجد سطور لربطها';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_item_ids) AS x(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.order_items i
      WHERE i.id = x.id AND i.order_id = p_order_id
    )
  ) THEN
    RAISE EXCEPTION 'سطر لا ينتمي إلى الطلب';
  END IF;

  SELECT count(*) INTO v_existing
  FROM public.order_box_copies
  WHERE order_id = p_order_id AND offer_name = v_name;

  IF v_existing = 0 THEN
    SELECT quantity INTO v_index
    FROM public.order_offer_instances
    WHERE order_id = p_order_id AND offer_name = v_name;
    v_index := coalesce(v_index, 1);
  ELSE
    SELECT max(copy_index) + 1 INTO v_index
    FROM public.order_box_copies
    WHERE order_id = p_order_id AND offer_name = v_name;
  END IF;

  INSERT INTO public.order_box_copies (
    order_id, offer_box_id, offer_name, copy_index, recorded_price, active
  ) VALUES (
    p_order_id, p_offer_box_id, v_name, v_index, 0, true
  ) RETURNING id INTO v_id;

  UPDATE public.order_items
  SET offer_copy_id = v_id,
      offer_name = v_name
  WHERE order_id = p_order_id
    AND id = ANY (p_item_ids);

  SELECT coalesce(round(sum(quantity * unit_price), 2), 0)
  INTO v_price
  FROM public.order_items
  WHERE offer_copy_id = v_id;

  UPDATE public.order_box_copies
  SET recorded_price = v_price
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_order_box_copy_change(
  p_order_id uuid,
  p_target_key text,
  p_operation text,
  p_payload jsonb,
  p_snapshot_token text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_order public.orders%ROWTYPE;
  v_audit public.order_box_copy_audit%ROWTYPE;
  v_inst public.order_offer_instances%ROWTYPE;
  v_copy public.order_box_copies%ROWTYPE;
  v_key text := btrim(coalesce(p_target_key, ''));
  v_op text := btrim(coalesce(p_operation, ''));
  v_items jsonb := '[]'::jsonb;
  v_new_name text;
  v_new_box uuid;
  v_elem jsonb;
  v_removed jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_source_name text;
  v_source_box uuid;
  v_source_index integer;
  v_source_kind text;
  v_new_copy uuid;
  v_new_index integer;
  v_qty numeric;
  v_unit numeric;
  v_gift boolean;
  v_pid uuid;
  v_pname text;
  v_line_id uuid;
  v_removed_price numeric := 0;
  v_added_price numeric := 0;
  v_next_included numeric := 0;
  v_prev_included numeric := 0;
  v_new_fee numeric := 0;
  v_subtotal numeric := 0;
  v_new_total numeric := 0;
  v_delta numeric := 0;
  v_cash numeric := 0;
  v_fixed numeric := 0;
  v_result jsonb;
  v_ship numeric;
  v_row record;
  v_deltas jsonb := '{}'::jsonb;
  v_product text;
  v_change numeric;
  v_res_qty numeric;
  v_res_id uuid;
  v_new_res numeric;
  v_item_id uuid;
  v_stock numeric;
  v_other numeric;
  v_available numeric;
  v_agouza constant uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
BEGIN
  v_uid := public._assert_box_copy_editor();
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'مفتاح العملية مطلوب';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود';
  END IF;

  SELECT * INTO v_audit
  FROM public.order_box_copy_audit
  WHERE order_id = p_order_id AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    RETURN coalesce(v_audit.result, '{}'::jsonb) || jsonb_build_object('idempotent', true);
  END IF;

  IF v_order.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تعديل بوكسات طلب تم تسليمه أو إلغاؤه';
  END IF;

  IF p_snapshot_token IS NULL
     OR btrim(p_snapshot_token) = ''
     OR p_snapshot_token IS DISTINCT FROM public.order_box_snapshot_token(p_order_id) THEN
    RAISE EXCEPTION 'الطلب تغيّر. حدّث الشاشة ثم أعد المحاولة';
  END IF;

  IF v_op NOT IN ('replace_box', 'replace_products', 'delete') THEN
    RAISE EXCEPTION 'نوع العملية غير معروف';
  END IF;

  IF p_payload IS NULL THEN
    v_items := '[]'::jsonb;
  ELSIF jsonb_typeof(p_payload) = 'array' THEN
    v_items := p_payload;
  ELSE
    v_items := coalesce(p_payload->'items', '[]'::jsonb);
  END IF;

  IF v_op = 'replace_box' THEN
    v_new_name := btrim(coalesce(p_payload->>'offer_name', ''));
    IF v_new_name = '' THEN
      RAISE EXCEPTION 'اسم البوكس البديل مطلوب';
    END IF;
    IF nullif(p_payload->>'offer_box_id', '') IS NOT NULL THEN
      BEGIN
        v_new_box := (p_payload->>'offer_box_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'البوكس البديل غير موجود';
      END;
      IF NOT EXISTS (SELECT 1 FROM public.offer_boxes WHERE id = v_new_box) THEN
        RAISE EXCEPTION 'البوكس البديل غير موجود';
      END IF;
    END IF;
  END IF;

  IF v_op <> 'delete' THEN
    IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
      RAISE EXCEPTION 'لا توجد منتجات بديلة';
    END IF;
    FOR v_elem IN SELECT value FROM jsonb_array_elements(v_items) LOOP
      IF coalesce((v_elem->>'quantity')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION 'كمية المنتج البديل يجب أن تكون أكبر من صفر';
      END IF;
      IF coalesce((v_elem->>'unit_price')::numeric, 0) < 0 THEN
        RAISE EXCEPTION 'سعر المنتج البديل غير صالح';
      END IF;
      IF btrim(coalesce(v_elem->>'product_name', '')) = '' THEN
        RAISE EXCEPTION 'اسم المنتج البديل مطلوب';
      END IF;
    END LOOP;
  END IF;

  v_copy := NULL;
  v_inst := NULL;

  IF v_key = 'plain' THEN
    v_source_kind := 'plain';
    v_source_name := NULL;
    v_source_box := NULL;
    v_source_index := 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.order_items i
      WHERE i.order_id = p_order_id AND btrim(coalesce(i.offer_name, '')) = ''
    ) THEN
      RAISE EXCEPTION 'النسخة غير موجودة';
    END IF;
  ELSIF v_key LIKE 'orphan:%' THEN
    v_source_kind := 'orphan';
    v_source_name := substr(v_key, 8);
    v_source_box := NULL;
    v_source_index := 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.order_items i
      WHERE i.order_id = p_order_id AND btrim(coalesce(i.offer_name, '')) = v_source_name
    ) THEN
      RAISE EXCEPTION 'النسخة غير موجودة';
    END IF;
  ELSIF v_key LIKE 'copy:%' THEN
    v_source_kind := 'materialized';
    BEGIN
      v_copy := NULL;
      SELECT * INTO v_copy
      FROM public.order_box_copies
      WHERE id = substr(v_key, 6)::uuid
        AND order_id = p_order_id
        AND active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'النسخة غير موجودة';
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'النسخة غير موجودة';
    END;
    v_source_name := v_copy.offer_name;
    v_source_box := v_copy.offer_box_id;
    v_source_index := v_copy.copy_index;
  ELSIF v_key LIKE 'inst:%' THEN
    v_source_kind := 'virtual';
    BEGIN
      v_inst := NULL;
      SELECT * INTO v_inst
      FROM public.order_offer_instances
      WHERE id = substr(v_key, 6, 36)::uuid
        AND order_id = p_order_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'النسخة غير موجودة';
      END IF;
      v_source_index := substr(v_key, 43)::integer;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'النسخة غير موجودة';
      WHEN numeric_value_out_of_range THEN
        RAISE EXCEPTION 'النسخة غير موجودة';
    END;
    PERFORM public._materialize_offer_box_copies(p_order_id, v_inst.offer_name);
    v_copy := NULL;
    SELECT * INTO v_copy
    FROM public.order_box_copies
    WHERE order_id = p_order_id
      AND offer_name = v_inst.offer_name
      AND copy_index = v_source_index
      AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'النسخة غير موجودة';
    END IF;
    v_source_name := v_copy.offer_name;
    v_source_box := coalesce(v_copy.offer_box_id, v_inst.offer_box_id);
    v_source_index := v_copy.copy_index;
  ELSE
    RAISE EXCEPTION 'النسخة غير موجودة';
  END IF;

  PERFORM set_config('app.skip_order_recompute', 'on', true);

  IF v_source_kind = 'plain' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'product_id', i.product_id, 'product_name', i.product_name,
      'quantity', i.quantity, 'unit_price', i.unit_price, 'offer_name', i.offer_name,
      'is_gift', coalesce(i.is_gift, false)
    )), '[]'::jsonb)
    INTO v_removed
    FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = ''
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن');
    DELETE FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = ''
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن');
  ELSIF v_source_kind = 'orphan' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'product_id', i.product_id, 'product_name', i.product_name,
      'quantity', i.quantity, 'unit_price', i.unit_price, 'offer_name', i.offer_name,
      'is_gift', coalesce(i.is_gift, false)
    )), '[]'::jsonb)
    INTO v_removed
    FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = v_source_name
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن');
    DELETE FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = v_source_name
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن');
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'product_id', i.product_id, 'product_name', i.product_name,
      'quantity', i.quantity, 'unit_price', i.unit_price, 'offer_name', i.offer_name,
      'is_gift', coalesce(i.is_gift, false)
    )), '[]'::jsonb)
    INTO v_removed
    FROM public.order_items i
    WHERE i.offer_copy_id = v_copy.id;
    DELETE FROM public.order_items WHERE offer_copy_id = v_copy.id;
    UPDATE public.order_box_copies SET active = false WHERE id = v_copy.id;
  END IF;

  SELECT coalesce(sum((elem->>'quantity')::numeric * (elem->>'unit_price')::numeric), 0)
  INTO v_removed_price
  FROM jsonb_array_elements(v_removed) elem
  WHERE coalesce((elem->>'is_gift')::boolean, false) = false;

  IF v_op = 'replace_box' OR v_op = 'replace_products' THEN
    IF v_op = 'replace_box' THEN
      SELECT coalesce(max(copy_index), 0) + 1 INTO v_new_index
      FROM public.order_box_copies
      WHERE order_id = p_order_id AND offer_name = v_new_name;
      INSERT INTO public.order_box_copies (
        order_id, offer_box_id, offer_name, copy_index, recorded_price, active
      ) VALUES (
        p_order_id, v_new_box, v_new_name, v_new_index, 0, true
      ) RETURNING id INTO v_new_copy;
    END IF;

    FOR v_elem IN SELECT value FROM jsonb_array_elements(v_items) LOOP
      v_qty := (v_elem->>'quantity')::numeric;
      v_gift := coalesce((v_elem->>'is_gift')::boolean, false);
      v_unit := CASE WHEN v_gift THEN 0 ELSE (v_elem->>'unit_price')::numeric END;
      v_pname := btrim(v_elem->>'product_name');
      v_pid := nullif(v_elem->>'product_id', '')::uuid;
      INSERT INTO public.order_items (
        order_id, product_id, product_name, quantity, unit_price, total_price,
        offer_name, offer_copy_id, is_gift
      ) VALUES (
        p_order_id,
        v_pid,
        v_pname,
        v_qty,
        v_unit,
        round(v_qty * v_unit, 2),
        CASE WHEN v_op = 'replace_box' THEN v_new_name ELSE NULL END,
        CASE WHEN v_op = 'replace_box' THEN v_new_copy ELSE NULL END,
        v_gift
      ) RETURNING id INTO v_line_id;
      v_added := v_added || jsonb_build_object(
        'id', v_line_id,
        'product_id', v_pid,
        'product_name', v_pname,
        'quantity', v_qty,
        'unit_price', v_unit,
        'is_gift', v_gift,
        'offer_name', CASE WHEN v_op = 'replace_box' THEN v_new_name ELSE NULL END
      );
      IF NOT v_gift THEN
        v_added_price := v_added_price + (v_qty * v_unit);
      END IF;
    END LOOP;

    IF v_op = 'replace_box' THEN
      UPDATE public.order_box_copies
      SET recorded_price = round(v_added_price, 2)
      WHERE id = v_new_copy;
    END IF;
  END IF;

  IF v_source_name IS NOT NULL THEN
    PERFORM public._sync_offer_instance_count(p_order_id, v_source_name, v_source_box, v_uid);
  END IF;
  IF v_op = 'replace_box' THEN
    PERFORM public._sync_offer_instance_count(p_order_id, v_new_name, v_new_box, v_uid);
  END IF;

  FOR v_row IN
    SELECT offer_name, offer_box_id, quantity
    FROM public.order_offer_instances
    WHERE order_id = p_order_id
  LOOP
    v_next_included := v_next_included
      + public._box_offer_shipping(v_row.offer_box_id, v_row.offer_name) * v_row.quantity;
  END LOOP;
  v_prev_included := v_next_included;
  IF v_source_kind <> 'plain' AND v_source_name IS NOT NULL THEN
    v_prev_included := v_prev_included + public._box_offer_shipping(v_source_box, v_source_name);
  END IF;
  IF v_op = 'replace_box' THEN
    v_prev_included := v_prev_included - public._box_offer_shipping(v_new_box, v_new_name);
  END IF;

  IF abs(coalesce(v_order.delivery_fee, 0) - v_prev_included) < 0.01 THEN
    v_new_fee := v_next_included;
  ELSE
    v_new_fee := coalesce(v_order.delivery_fee, 0) + (v_next_included - v_prev_included);
  END IF;
  IF v_new_fee < 0 THEN
    v_new_fee := 0;
  END IF;
  v_new_fee := round(v_new_fee, 2);

  SELECT coalesce(round(sum(i.quantity * i.unit_price), 2), 0)
  INTO v_subtotal
  FROM public.order_items i
  WHERE i.order_id = p_order_id
    AND coalesce(i.is_gift, false) = false
    AND NOT (
      i.product_id IS NULL
      AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن'
      AND btrim(coalesce(i.offer_name, '')) <> ''
    );

  v_new_total := round(
    v_subtotal - coalesce(v_order.discount, 0) + coalesce(v_order.extra_charge, 0) + v_new_fee,
    2
  );

  -- Stock: only the selected copy's product delta, and only when this order
  -- already has active Agouza reservations. Never a full release/re-reserve.
  IF v_order.source_warehouse_id = v_agouza
     AND v_order.stock_status IS DISTINCT FROM 'dispatched'
     AND to_regclass('public.agouza_stock_reservations') IS NOT NULL
     AND to_regclass('public.inventory_items') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.agouza_stock_reservations r
       WHERE r.order_id = p_order_id AND r.status = 'active'
     )
  THEN
    FOR v_elem IN SELECT value FROM jsonb_array_elements(v_removed) LOOP
      IF nullif(v_elem->>'product_id', '') IS NULL THEN
        CONTINUE;
      END IF;
      v_product := v_elem->>'product_id';
      v_deltas := jsonb_set(
        v_deltas,
        ARRAY[v_product],
        to_jsonb(coalesce((v_deltas->>v_product)::numeric, 0) - (v_elem->>'quantity')::numeric),
        true
      );
    END LOOP;
    FOR v_elem IN SELECT value FROM jsonb_array_elements(v_added) LOOP
      IF nullif(v_elem->>'product_id', '') IS NULL THEN
        CONTINUE;
      END IF;
      v_product := v_elem->>'product_id';
      v_deltas := jsonb_set(
        v_deltas,
        ARRAY[v_product],
        to_jsonb(coalesce((v_deltas->>v_product)::numeric, 0) + (v_elem->>'quantity')::numeric),
        true
      );
    END LOOP;

    FOR v_product, v_change IN
      SELECT key, value::numeric FROM jsonb_each_text(v_deltas)
    LOOP
      IF abs(v_change) <= 0.0000001 THEN
        CONTINUE;
      END IF;
      v_pid := v_product::uuid;

      PERFORM 1
      FROM public.agouza_stock_reservations r
      WHERE r.order_id = p_order_id AND r.product_id = v_pid AND r.status = 'active'
      FOR UPDATE;

      SELECT coalesce(sum(r.quantity), 0) INTO v_res_qty
      FROM public.agouza_stock_reservations r
      WHERE r.order_id = p_order_id AND r.product_id = v_pid AND r.status = 'active';

      v_res_id := NULL;
      SELECT r.id INTO v_res_id
      FROM public.agouza_stock_reservations r
      WHERE r.order_id = p_order_id AND r.product_id = v_pid AND r.status = 'active'
      ORDER BY r.reserved_at
      LIMIT 1
      FOR UPDATE;

      v_new_res := coalesce(v_res_qty, 0) + v_change;

      IF v_change > 0 THEN
        SELECT ii.id, coalesce(ii.stock, 0)
        INTO v_item_id, v_stock
        FROM public.inventory_items ii
        WHERE ii.warehouse_id = v_agouza AND ii.product_id = v_pid
        ORDER BY ii.id
        LIMIT 1
        FOR UPDATE;
        IF NOT FOUND THEN
          v_stock := 0;
          v_item_id := NULL;
        END IF;
        SELECT coalesce(sum(r.quantity), 0) INTO v_other
        FROM public.agouza_stock_reservations r
        WHERE r.product_id = v_pid
          AND r.status = 'active'
          AND r.order_id <> p_order_id;
        v_available := coalesce(v_stock, 0) - coalesce(v_other, 0);
        IF v_new_res > v_available + 0.0000001 OR v_item_id IS NULL THEN
          SELECT coalesce(
            (SELECT elem->>'product_name' FROM jsonb_array_elements(v_added) elem WHERE elem->>'product_id' = v_product LIMIT 1),
            (SELECT elem->>'product_name' FROM jsonb_array_elements(v_removed) elem WHERE elem->>'product_id' = v_product LIMIT 1),
            v_product
          ) INTO v_pname;
          RAISE EXCEPTION 'المخزون غير كافٍ للمنتج %', v_pname;
        END IF;
        IF v_res_id IS NULL THEN
          INSERT INTO public.agouza_stock_reservations (
            order_id, product_id, inventory_item_id, quantity, status, reserved_by
          ) VALUES (
            p_order_id, v_pid, v_item_id, v_new_res, 'active', v_uid
          );
        ELSE
          UPDATE public.agouza_stock_reservations
          SET quantity = v_new_res, updated_at = now()
          WHERE id = v_res_id;
          UPDATE public.agouza_stock_reservations
          SET status = 'released',
              released_at = now(),
              released_by = v_uid,
              release_reason = 'box_copy_change_merged',
              updated_at = now()
          WHERE order_id = p_order_id
            AND product_id = v_pid
            AND status = 'active'
            AND id <> v_res_id;
        END IF;
      ELSE
        IF v_new_res <= 0.0000001 THEN
          UPDATE public.agouza_stock_reservations
          SET status = 'released',
              released_at = now(),
              released_by = v_uid,
              release_reason = 'box_copy_change',
              updated_at = now()
          WHERE order_id = p_order_id AND product_id = v_pid AND status = 'active';
        ELSE
          UPDATE public.agouza_stock_reservations
          SET quantity = v_new_res, updated_at = now()
          WHERE id = v_res_id;
          UPDATE public.agouza_stock_reservations
          SET status = 'released',
              released_at = now(),
              released_by = v_uid,
              release_reason = 'box_copy_change_merged',
              updated_at = now()
          WHERE order_id = p_order_id
            AND product_id = v_pid
            AND status = 'active'
            AND id <> v_res_id;
        END IF;
      END IF;
    END LOOP;
  END IF;

  v_delta := v_new_total - coalesce(v_order.total, 0);
  v_cash := coalesce(v_order.courier_cash_due, 0);
  IF v_order.collection_method = 'mixed_payment' THEN
    v_fixed := coalesce(v_order.vodafone_cash_amount, 0)
      + coalesce(v_order.instapay_amount, 0)
      + coalesce(v_order.bank_transfer_amount, 0)
      + coalesce(v_order.other_amount, 0)
      + coalesce(v_order.free_amount, 0)
      + coalesce(v_order.deposit_amount, 0);
    v_cash := round(coalesce(v_order.courier_cash_due, 0) + v_delta, 2);
    IF v_cash < -0.01 THEN
      RAISE EXCEPTION 'المدفوعات السابقة أكبر من إجمالي الطلب الجديد';
    END IF;
  ELSIF coalesce(v_order.courier_cash_due, 0) <> 0 THEN
    v_cash := greatest(0, round(coalesce(v_order.courier_cash_due, 0) + v_delta, 2));
  END IF;

  UPDATE public.orders
  SET subtotal = v_subtotal,
      delivery_fee = v_new_fee,
      total = v_new_total,
      courier_cash_due = CASE
        WHEN collection_method = 'mixed_payment' THEN v_cash
        WHEN coalesce(courier_cash_due, 0) <> 0 THEN v_cash
        ELSE courier_cash_due
      END,
      updated_at = now()
  WHERE id = p_order_id;

  v_result := jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'operation', v_op,
    'source_key', v_key,
    'previous_total', v_order.total,
    'new_total', v_new_total,
    'delivery_fee', v_new_fee,
    'subtotal', v_subtotal,
    'price_delta', round(v_added_price - v_removed_price, 2)
  );

  INSERT INTO public.order_box_copy_audit (
    order_id, idempotency_key, acted_by, operation, source_key,
    source_offer_name, source_copy_index, source_recorded_price,
    removed_items, added_items, price_delta, previous_total, new_total, result
  ) VALUES (
    p_order_id, btrim(p_idempotency_key), v_uid, v_op, v_key,
    v_source_name, v_source_index, round(v_removed_price, 2),
    v_removed, v_added, round(v_added_price - v_removed_price, 2),
    v_order.total, v_new_total, v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public._box_copy_qty_share(numeric, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._assert_box_copy_editor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._box_offer_shipping(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._materialize_offer_box_copies(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._sync_offer_instance_count(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.order_box_snapshot_token(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_order_box_copies(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_added_order_box_copy(uuid, text, uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_order_box_copy_change(uuid, text, text, jsonb, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.order_box_snapshot_token(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_order_box_copies(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_added_order_box_copy(uuid, text, uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_order_box_copy_change(uuid, text, text, jsonb, text, text) TO authenticated, service_role;
