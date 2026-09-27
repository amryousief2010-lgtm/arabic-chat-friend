-- Monthly outlet sales statements for Carrefour and Healthy Taste.
-- A statement is a draft, then each line posts once through post_outlet_sale.
-- source_id is the statement and source_line_id is the line, so a retry cannot
-- deduct again. A correction is a reversal with a written reason.
-- The movement is dated at the last second of the statement month (Africa/Cairo).
-- If a stocktake lock covers that month, only the general manager or the
-- executive manager may post, and only with a written override.

CREATE TABLE IF NOT EXISTS public.outlet_sales_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  period_month date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  notes text,
  override_reason text,
  posted_at timestamptz,
  posted_by uuid,
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS outlet_sales_statements_open_month_uidx
  ON public.outlet_sales_statements (warehouse_id, period_month)
  WHERE status IN ('draft', 'posted');

CREATE INDEX IF NOT EXISTS outlet_sales_statements_wh_month_idx
  ON public.outlet_sales_statements (warehouse_id, period_month DESC);

CREATE TABLE IF NOT EXISTS public.outlet_sales_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id uuid NOT NULL REFERENCES public.outlet_sales_statements(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  qty_input numeric NOT NULL CHECK (qty_input > 0),
  qty_unit text NOT NULL CHECK (qty_unit IN ('pack', 'kg')),
  pack_weight_kg numeric,
  quantity_kg numeric NOT NULL CHECK (quantity_kg > 0),
  amount numeric CHECK (amount IS NULL OR amount >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  movement_id uuid
);

CREATE INDEX IF NOT EXISTS outlet_sales_statement_lines_stmt_idx
  ON public.outlet_sales_statement_lines (statement_id, sort_order, id);

ALTER TABLE public.outlet_sales_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlet_sales_statement_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outlet_sales_statements_read ON public.outlet_sales_statements;
CREATE POLICY outlet_sales_statements_read ON public.outlet_sales_statements
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY[
      'general_manager','executive_manager','accountant','financial_manager'
    ]::public.app_role[])
  );

DROP POLICY IF EXISTS outlet_sales_statement_lines_read ON public.outlet_sales_statement_lines;
CREATE POLICY outlet_sales_statement_lines_read ON public.outlet_sales_statement_lines
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY[
      'general_manager','executive_manager','accountant','financial_manager'
    ]::public.app_role[])
  );

DROP POLICY IF EXISTS outlet_sales_statements_service ON public.outlet_sales_statements;
CREATE POLICY outlet_sales_statements_service ON public.outlet_sales_statements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS outlet_sales_statement_lines_service ON public.outlet_sales_statement_lines;
CREATE POLICY outlet_sales_statement_lines_service ON public.outlet_sales_statement_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.outlet_sales_statements TO authenticated, service_role;
GRANT SELECT ON public.outlet_sales_statement_lines TO authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.outlet_sales_statements FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.outlet_sales_statement_lines FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_outlet_sales_warehouse(p_warehouse_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_warehouse_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.warehouses w
     WHERE w.id = p_warehouse_id
       AND (
         w.id IN (
           'caeffc21-fa51-40f3-b621-713ed855a9d2'::uuid,
           '5725b7f8-506d-4174-8a38-d807b3cf1f7f'::uuid
         )
         OR w.name ILIKE '%كارفور%'
         OR w.name ILIKE '%carrefour%'
         OR w.name ILIKE '%هيلثي%'
         OR w.name ILIKE '%healthy%'
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.outlet_statement_actor_ok(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_uid IS NOT NULL AND (
    public.has_role(p_uid, 'general_manager'::public.app_role)
    OR public.has_role(p_uid, 'executive_manager'::public.app_role)
    OR public.has_role(p_uid, 'accountant'::public.app_role)
    OR public.has_role(p_uid, 'financial_manager'::public.app_role)
  );
$$;

CREATE OR REPLACE FUNCTION public.list_outlet_sales_warehouses()
RETURNS TABLE(id uuid, name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.outlet_statement_actor_ok(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: كشف مبيعات المنفذ للمحاسب أو المدير المالي أو المدير العام أو المدير التنفيذي';
  END IF;
  RETURN QUERY
  SELECT w.id, w.name
    FROM public.warehouses w
   WHERE public.is_outlet_sales_warehouse(w.id)
   ORDER BY w.name;
END;
$$;

-- Extra arguments keep the old five-argument call working.
DROP FUNCTION IF EXISTS public.post_outlet_sale(uuid, numeric, text, uuid, text);

CREATE OR REPLACE FUNCTION public.post_outlet_sale(
  p_item_id uuid,
  p_kg numeric,
  p_statement_ref text,
  p_source_id uuid,
  p_reason text DEFAULT NULL,
  p_source_line_id text DEFAULT NULL,
  p_performed_at timestamptz DEFAULT NULL,
  p_override_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_line text := COALESCE(NULLIF(btrim(COALESCE(p_source_line_id, '')), ''), '1');
BEGIN
  IF p_statement_ref IS NULL OR length(btrim(p_statement_ref)) < 2 THEN
    RAISE EXCEPTION 'STATEMENT_REQUIRED: رقم كشف المبيعات مطلوب';
  END IF;
  IF p_kg IS NULL OR p_kg <= 0 THEN
    RAISE EXCEPTION 'الكمية بالكيلو يجب أن تكون أكبر من صفر';
  END IF;
  RETURN public.post_inventory_movement(
    p_item_id, 'out', p_kg, 'outlet_sale',
    COALESCE(p_source_id, gen_random_uuid()), v_line,
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'كشف مبيعات منفذ'),
    'كشف ' || btrim(p_statement_ref),
    COALESCE(p_performed_at, now()),
    NULL,
    btrim(p_statement_ref),
    btrim(p_statement_ref),
    'delta', false,
    NULL, NULL, 'outlet', NULL,
    NULLIF(btrim(COALESCE(p_override_reason, '')), ''),
    'outlet_sale', NULL, NULL, NULL, NULL, NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_outlet_sales_statement(
  p_id uuid,
  p_warehouse_id uuid,
  p_month date,
  p_notes text,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_month date;
  v_status text;
  v_elem jsonb;
  v_ord int;
  v_item uuid;
  v_qty numeric;
  v_unit text;
  v_amount numeric;
  v_weight numeric;
  v_kg numeric;
  v_name text;
  v_item_wh uuid;
  v_count int := 0;
  v_total numeric := 0;
BEGIN
  IF NOT public.outlet_statement_actor_ok(v_uid) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: كشف مبيعات المنفذ للمحاسب أو المدير المالي أو المدير العام أو المدير التنفيذي';
  END IF;
  IF NOT public.is_outlet_sales_warehouse(p_warehouse_id) THEN
    RAISE EXCEPTION 'OUTLET_ONLY: الكشف لمخزن كارفور أو هيلثي تيست فقط';
  END IF;
  IF p_month IS NULL THEN
    RAISE EXCEPTION 'الشهر مطلوب';
  END IF;
  v_month := date_trunc('month', p_month)::date;
  IF p_lines IS NOT NULL AND jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'بنود الكشف يجب أن تكون قائمة';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.outlet_sales_statements (warehouse_id, period_month, notes, created_by)
    VALUES (p_warehouse_id, v_month, NULLIF(btrim(COALESCE(p_notes, '')), ''), v_uid)
    RETURNING id INTO p_id;
  ELSE
    SELECT status INTO v_status
      FROM public.outlet_sales_statements
     WHERE id = p_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الكشف غير موجود';
    END IF;
    IF v_status <> 'draft' THEN
      RAISE EXCEPTION 'لا يُعدَّل إلا كشف مسودة. الكشف المرحّل يُعكس بسبب مكتوب';
    END IF;
    UPDATE public.outlet_sales_statements
       SET warehouse_id = p_warehouse_id,
           period_month = v_month,
           notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
     WHERE id = p_id;
    DELETE FROM public.outlet_sales_statement_lines WHERE statement_id = p_id;
  END IF;

  FOR v_elem, v_ord IN
    SELECT value, ordinality::int
      FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY
  LOOP
    IF NULLIF(btrim(COALESCE(v_elem->>'item_id', '')), '') IS NULL THEN
      RAISE EXCEPTION 'سطر % بلا صنف', v_ord;
    END IF;
    v_item := (v_elem->>'item_id')::uuid;
    v_qty := (v_elem->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'كمية السطر % يجب أن تكون أكبر من صفر', v_ord;
    END IF;
    v_unit := lower(btrim(COALESCE(v_elem->>'unit', '')));
    IF v_unit IN ('pack', 'عبوة', 'عبوات') THEN
      v_unit := 'pack';
    ELSIF v_unit IN ('kg', 'كجم', 'كيلو', 'كيلوجرام') THEN
      v_unit := 'kg';
    ELSE
      RAISE EXCEPTION 'وحدة السطر % يجب أن تكون عبوة أو كجم', v_ord;
    END IF;
    v_amount := NULL;
    IF NULLIF(btrim(COALESCE(v_elem->>'amount', '')), '') IS NOT NULL THEN
      v_amount := (v_elem->>'amount')::numeric;
      IF v_amount < 0 THEN
        RAISE EXCEPTION 'مبلغ السطر % لا يكون سالباً', v_ord;
      END IF;
    END IF;

    SELECT i.warehouse_id, i.pack_weight_kg, i.name
      INTO v_item_wh, v_weight, v_name
      FROM public.inventory_items i
     WHERE i.id = v_item;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الصنف في السطر % غير موجود', v_ord;
    END IF;
    IF v_item_wh IS DISTINCT FROM p_warehouse_id THEN
      RAISE EXCEPTION 'الصنف في السطر % ليس من مخزن هذا الكشف', v_ord;
    END IF;

    IF v_unit = 'kg' THEN
      v_kg := v_qty;
      v_weight := NULL;
    ELSE
      v_weight := COALESCE(v_weight, public.default_pack_weight_kg(v_name));
      IF v_weight IS NULL OR v_weight <= 0 THEN
        RAISE EXCEPTION 'وزن عبوة الصنف في السطر % غير معروف', v_ord;
      END IF;
      v_kg := round(v_qty * v_weight, 3);
    END IF;

    INSERT INTO public.outlet_sales_statement_lines (
      statement_id, item_id, qty_input, qty_unit, pack_weight_kg, quantity_kg, amount, sort_order
    ) VALUES (
      p_id, v_item, v_qty, v_unit, v_weight, v_kg, v_amount, v_ord
    );
    v_count := v_count + 1;
    v_total := v_total + v_kg;
  END LOOP;

  RETURN jsonb_build_object(
    'id', p_id,
    'status', 'draft',
    'period_month', v_month,
    'line_count', v_count,
    'total_kg', v_total
  );
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'يوجد كشف مسودة أو مرحّل لنفس المخزن والشهر';
END;
$$;

CREATE OR REPLACE FUNCTION public.post_outlet_sales_statement(
  p_id uuid,
  p_override_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_st public.outlet_sales_statements%ROWTYPE;
  v_line public.outlet_sales_statement_lines%ROWTYPE;
  v_when timestamptz;
  v_lock timestamptz;
  v_start timestamptz;
  v_res jsonb;
  v_count int := 0;
  v_override text := NULLIF(btrim(COALESCE(p_override_reason, '')), '');
BEGIN
  IF NOT public.outlet_statement_actor_ok(v_uid) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: كشف مبيعات المنفذ للمحاسب أو المدير المالي أو المدير العام أو المدير التنفيذي';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'الكشف مطلوب';
  END IF;

  SELECT * INTO v_st FROM public.outlet_sales_statements WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الكشف غير موجود';
  END IF;
  IF v_st.status = 'posted' THEN
    RETURN jsonb_build_object('id', v_st.id, 'status', 'already_posted');
  END IF;
  IF v_st.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يُرحَّل إلا كشف مسودة';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.outlet_sales_statement_lines WHERE statement_id = p_id) THEN
    RAISE EXCEPTION 'الكشف بلا بنود';
  END IF;

  v_when := ((v_st.period_month + interval '1 month')::timestamp AT TIME ZONE 'Africa/Cairo') - interval '1 second';
  v_start := (v_st.period_month::timestamp AT TIME ZONE 'Africa/Cairo');
  v_lock := public.warehouse_period_locked_until(v_st.warehouse_id);
  IF v_lock IS NOT NULL AND v_lock > v_start THEN
    IF v_override IS NULL OR length(v_override) < 3
       OR NOT (
         public.has_role(v_uid, 'general_manager'::public.app_role)
         OR public.has_role(v_uid, 'executive_manager'::public.app_role)
       ) THEN
      RAISE EXCEPTION
        'الفترة مقفلة لهذا المخزن حتى %. كشف هذا الشهر يحتاج تجاوز المدير العام أو المدير التنفيذي مع سبب مكتوب.',
        to_char(v_lock AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI');
    END IF;
  ELSE
    v_override := NULL;
  END IF;

  FOR v_line IN
    SELECT * FROM public.outlet_sales_statement_lines
     WHERE statement_id = p_id
     ORDER BY sort_order, id
  LOOP
    v_res := public.post_outlet_sale(
      v_line.item_id,
      v_line.quantity_kg,
      to_char(v_st.period_month, 'YYYY-MM'),
      v_st.id,
      COALESCE(NULLIF(btrim(COALESCE(v_st.notes, '')), ''), 'كشف مبيعات منفذ'),
      v_line.id::text,
      v_when,
      v_override
    );
    IF COALESCE(v_res->>'status', '') NOT IN ('posted', 'already_posted') THEN
      RAISE EXCEPTION 'تعذر ترحيل سطر الكشف: %', v_res;
    END IF;
    UPDATE public.outlet_sales_statement_lines
       SET movement_id = NULLIF(v_res->>'id', '')::uuid
     WHERE id = v_line.id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.outlet_sales_statements
     SET status = 'posted',
         posted_at = now(),
         posted_by = v_uid,
         override_reason = v_override
   WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'status', 'posted', 'line_count', v_count, 'performed_at', v_when);
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_outlet_sales_statement(
  p_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_st public.outlet_sales_statements%ROWTYPE;
  v_line public.outlet_sales_statement_lines%ROWTYPE;
  v_res jsonb;
  v_count int := 0;
BEGIN
  IF NOT public.outlet_statement_actor_ok(v_uid) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: كشف مبيعات المنفذ للمحاسب أو المدير المالي أو المدير العام أو المدير التنفيذي';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: سبب العكس مطلوب (٣ حروف على الأقل)';
  END IF;

  SELECT * INTO v_st FROM public.outlet_sales_statements WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الكشف غير موجود';
  END IF;
  IF v_st.status = 'reversed' THEN
    RETURN jsonb_build_object('id', v_st.id, 'status', 'already_reversed');
  END IF;
  IF v_st.status <> 'posted' THEN
    RAISE EXCEPTION 'لا يُعكس إلا كشف مرحّل';
  END IF;

  -- The statement role check already authorized the actor. Reversal itself
  -- is a manual capability the accountant does not hold on the card.
  PERFORM set_config('app.inventory_internal_post', 'on', true);
  FOR v_line IN
    SELECT * FROM public.outlet_sales_statement_lines
     WHERE statement_id = p_id AND movement_id IS NOT NULL
     ORDER BY sort_order, id
  LOOP
    v_res := public.reverse_posted_inventory_movement(v_line.movement_id, btrim(p_reason));
    IF COALESCE(v_res->>'status', '') NOT IN ('posted', 'already_reversed', 'zero_effect') THEN
      PERFORM set_config('app.inventory_internal_post', 'off', true);
      RAISE EXCEPTION 'تعذر عكس سطر الكشف: %', v_res;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  PERFORM set_config('app.inventory_internal_post', 'off', true);

  UPDATE public.outlet_sales_statements
     SET status = 'reversed',
         reversed_at = now(),
         reversed_by = v_uid,
         reversal_reason = btrim(p_reason)
   WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'status', 'reversed', 'line_count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.is_outlet_sales_warehouse(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outlet_statement_actor_ok(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_outlet_sales_warehouses() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_outlet_sale(uuid, numeric, text, uuid, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_outlet_sales_statement(uuid, uuid, date, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_outlet_sales_statement(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_outlet_sales_statement(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_outlet_sales_warehouse(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_outlet_sales_warehouses() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_outlet_sale(uuid, numeric, text, uuid, text, text, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_outlet_sales_statement(uuid, uuid, date, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_outlet_sales_statement(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_outlet_sales_statement(uuid, text) TO authenticated, service_role;
