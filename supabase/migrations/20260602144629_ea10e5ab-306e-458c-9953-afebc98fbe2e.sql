
-- 1) Manufacturing invoice tables
CREATE TABLE IF NOT EXISTS public.meat_manufacturing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text NOT NULL UNIQUE,
  product_name text NOT NULL,
  finished_qty numeric NOT NULL CHECK (finished_qty > 0),
  unit text NOT NULL DEFAULT 'كجم',
  factory_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  finished_item_id uuid REFERENCES public.inventory_items(id),
  materials_total_cost numeric NOT NULL DEFAULT 0,
  unit_cost numeric,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','transferred','cancelled')),
  notes text,
  transfer_id uuid REFERENCES public.warehouse_transfers(id),
  transfer_no text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  transferred_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  transferred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.meat_manufacturing_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.meat_manufacturing_invoices(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  item_name text NOT NULL,
  unit text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mmi_status ON public.meat_manufacturing_invoices(status);
CREATE INDEX IF NOT EXISTS idx_mmi_warehouse ON public.meat_manufacturing_invoices(factory_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_mmil_invoice ON public.meat_manufacturing_invoice_lines(invoice_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_manufacturing_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_manufacturing_invoice_lines TO authenticated;
GRANT ALL ON public.meat_manufacturing_invoices TO service_role;
GRANT ALL ON public.meat_manufacturing_invoice_lines TO service_role;

ALTER TABLE public.meat_manufacturing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meat_manufacturing_invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view mmi" ON public.meat_manufacturing_invoices;
CREATE POLICY "view mmi" ON public.meat_manufacturing_invoices
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "manage mmi" ON public.meat_manufacturing_invoices;
CREATE POLICY "manage mmi" ON public.meat_manufacturing_invoices
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'production_manager'::app_role,
    'meat_factory_manager'::app_role
  ]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'production_manager'::app_role,
    'meat_factory_manager'::app_role
  ]));

DROP POLICY IF EXISTS "view mmi lines" ON public.meat_manufacturing_invoice_lines;
CREATE POLICY "view mmi lines" ON public.meat_manufacturing_invoice_lines
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "manage mmi lines" ON public.meat_manufacturing_invoice_lines;
CREATE POLICY "manage mmi lines" ON public.meat_manufacturing_invoice_lines
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'production_manager'::app_role,
    'meat_factory_manager'::app_role
  ]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'production_manager'::app_role,
    'meat_factory_manager'::app_role
  ]));

CREATE TRIGGER trg_mmi_updated
  BEFORE UPDATE ON public.meat_manufacturing_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Invoice number generator
CREATE OR REPLACE FUNCTION public.gen_meat_invoice_no()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq int;
BEGIN
  SELECT COUNT(*) + 1 INTO v_seq
  FROM public.meat_manufacturing_invoices
  WHERE created_at >= date_trunc('year', now());
  RETURN 'MFG-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 5, '0');
END;
$$;

-- 3) Approve invoice: deduct materials + create finished product stock
CREATE OR REPLACE FUNCTION public.approve_meat_manufacturing_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.meat_manufacturing_invoices%ROWTYPE;
  v_line record;
  v_src public.inventory_items%ROWTYPE;
  v_finished_item_id uuid;
  v_total numeric := 0;
  v_lines int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'production_manager'::app_role,
    'meat_factory_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  SELECT * INTO v_inv FROM public.meat_manufacturing_invoices
    WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'already_processed: %', v_inv.status;
  END IF;

  -- Validate stock and deduct each material
  FOR v_line IN
    SELECT * FROM public.meat_manufacturing_invoice_lines WHERE invoice_id = p_invoice_id
  LOOP
    SELECT * INTO v_src FROM public.inventory_items
      WHERE id = v_line.item_id AND warehouse_id = v_inv.factory_warehouse_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'material_not_in_factory_warehouse: %', v_line.item_name;
    END IF;
    IF v_src.stock < v_line.quantity THEN
      RAISE EXCEPTION 'insufficient_stock: % (have %, need %)',
        v_src.name, v_src.stock, v_line.quantity;
    END IF;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity,
      unit_cost, performed_by, notes, reference
    ) VALUES (
      v_src.id, v_inv.factory_warehouse_id, 'out', v_line.quantity,
      v_line.unit_cost, v_uid,
      'صرف خامة للتصنيع — ' || v_inv.product_name,
      v_inv.invoice_no
    );

    v_total := v_total + v_line.line_total;
    v_lines := v_lines + 1;
  END LOOP;

  IF v_lines = 0 THEN
    RAISE EXCEPTION 'no_materials';
  END IF;

  -- Find or create finished product item in same factory warehouse
  SELECT id INTO v_finished_item_id FROM public.inventory_items
    WHERE warehouse_id = v_inv.factory_warehouse_id
      AND trim(name) = trim(v_inv.product_name)
      AND category = 'منتج تام مصنع اللحوم'
    LIMIT 1;

  IF v_finished_item_id IS NULL THEN
    INSERT INTO public.inventory_items(
      warehouse_id, name, category, unit, stock, unit_cost, low_stock_threshold
    ) VALUES (
      v_inv.factory_warehouse_id, v_inv.product_name, 'منتج تام مصنع اللحوم',
      v_inv.unit, 0, ROUND(v_total / NULLIF(v_inv.finished_qty,0), 3), 0
    ) RETURNING id INTO v_finished_item_id;
  END IF;

  INSERT INTO public.inventory_movements(
    item_id, warehouse_id, movement_type, quantity,
    unit_cost, performed_by, notes, reference, party
  ) VALUES (
    v_finished_item_id, v_inv.factory_warehouse_id, 'in', v_inv.finished_qty,
    ROUND(v_total / NULLIF(v_inv.finished_qty,0), 3), v_uid,
    'إنتاج تام من فاتورة تصنيع ' || v_inv.invoice_no,
    v_inv.invoice_no, 'مصنع اللحوم'
  );

  UPDATE public.meat_manufacturing_invoices
    SET status = 'approved',
        approved_by = v_uid,
        approved_at = now(),
        finished_item_id = v_finished_item_id,
        materials_total_cost = v_total,
        unit_cost = ROUND(v_total / NULLIF(finished_qty,0), 3),
        updated_at = now()
    WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_no', v_inv.invoice_no,
    'finished_item_id', v_finished_item_id,
    'materials_cost', v_total
  );
END;
$$;

-- 4) Allow meat factory manager to use create_and_send_transfer
CREATE OR REPLACE FUNCTION public.create_and_send_transfer(
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_transfer_id uuid;
  v_transfer_no text;
  v_line jsonb;
  v_src_item record;
  v_dest_item public.inventory_items%ROWTYPE;
  v_qty numeric;
  v_src_mv_id uuid;
  v_lines_created int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
    OR public.has_role(v_uid, 'warehouse_supervisor'::app_role)
    OR public.has_role(v_uid, 'meat_factory_manager'::app_role)
    OR public.has_role(v_uid, 'production_manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  IF p_source_warehouse_id = p_destination_warehouse_id THEN
    RAISE EXCEPTION 'same_warehouse';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'no_lines';
  END IF;

  v_transfer_no := public.gen_transfer_no();

  INSERT INTO public.warehouse_transfers(
    transfer_no, source_warehouse_id, destination_warehouse_id,
    status, created_by, sent_by, sent_at, notes,
    legacy_dual_post, audit_log
  ) VALUES (
    v_transfer_no, p_source_warehouse_id, p_destination_warehouse_id,
    'pending_receipt', v_uid, v_uid, now(), p_notes,
    false,
    jsonb_build_array(jsonb_build_object(
      'event','created_and_sent','by',v_uid,'at',now()
    ))
  ) RETURNING id INTO v_transfer_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (v_line->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_src_item FROM public.inventory_items
      WHERE id = (v_line->>'source_item_id')::uuid
        AND warehouse_id = p_source_warehouse_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'source_item_not_found: %', v_line->>'source_item_id';
    END IF;
    IF v_src_item.stock < v_qty THEN
      RAISE EXCEPTION 'insufficient_stock: % (have %, need %)', v_src_item.name, v_src_item.stock, v_qty;
    END IF;

    SELECT * INTO v_dest_item FROM public.inventory_items
      WHERE warehouse_id = p_destination_warehouse_id
        AND trim(name) = trim(v_src_item.name)
      LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.inventory_items(
        warehouse_id, name, category, sku, unit, stock,
        low_stock_threshold, unit_cost
      ) VALUES (
        p_destination_warehouse_id, v_src_item.name, v_src_item.category, v_src_item.sku,
        v_src_item.unit, 0, v_src_item.low_stock_threshold, v_src_item.unit_cost
      ) RETURNING * INTO v_dest_item;
    END IF;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity,
      destination_warehouse_id, unit_cost, performed_by,
      notes, reference, party
    ) VALUES (
      v_src_item.id, p_source_warehouse_id, 'transfer', v_qty,
      p_destination_warehouse_id, v_src_item.unit_cost, v_uid,
      'تحويل صادر (' || v_transfer_no || ')', v_transfer_no,
      COALESCE(p_notes_party_for_now(), NULL)
    ) RETURNING id INTO v_src_mv_id;

    INSERT INTO public.warehouse_transfer_items(
      transfer_id, source_item_id, destination_item_id, item_name, unit,
      requested_qty, sent_qty, unit_cost, total_cost,
      source_movement_id, destination_movement_id, line_status
    ) VALUES (
      v_transfer_id, v_src_item.id, v_dest_item.id, v_src_item.name, v_src_item.unit,
      v_qty, v_qty, v_src_item.unit_cost, v_qty * COALESCE(v_src_item.unit_cost, 0),
      v_src_mv_id, NULL, 'pending'
    );

    v_lines_created := v_lines_created + 1;
  END LOOP;

  IF v_lines_created = 0 THEN
    RAISE EXCEPTION 'no_valid_lines';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'transfer_id', v_transfer_id,
    'transfer_no', v_transfer_no,
    'lines', v_lines_created
  );
END;
$function$;

-- helper kept inline-safe; remove the bogus call above
CREATE OR REPLACE FUNCTION public.create_and_send_transfer(
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_transfer_id uuid;
  v_transfer_no text;
  v_line jsonb;
  v_src_item record;
  v_dest_item public.inventory_items%ROWTYPE;
  v_qty numeric;
  v_src_mv_id uuid;
  v_lines_created int := 0;
  v_src_wh_name text;
  v_party text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
    OR public.has_role(v_uid, 'warehouse_supervisor'::app_role)
    OR public.has_role(v_uid, 'meat_factory_manager'::app_role)
    OR public.has_role(v_uid, 'production_manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;
  IF p_source_warehouse_id = p_destination_warehouse_id THEN
    RAISE EXCEPTION 'same_warehouse';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'no_lines';
  END IF;

  SELECT name INTO v_src_wh_name FROM public.warehouses WHERE id = p_source_warehouse_id;
  v_party := CASE
    WHEN v_src_wh_name ILIKE '%مصنع اللحوم%' THEN 'مصنع اللحوم'
    WHEN v_src_wh_name ILIKE '%مصنع العلف%' THEN 'مصنع العلف'
    WHEN v_src_wh_name ILIKE '%مجزر%' THEN 'المجزر'
    ELSE v_src_wh_name
  END;

  v_transfer_no := public.gen_transfer_no();

  INSERT INTO public.warehouse_transfers(
    transfer_no, source_warehouse_id, destination_warehouse_id,
    status, created_by, sent_by, sent_at, notes,
    legacy_dual_post, audit_log
  ) VALUES (
    v_transfer_no, p_source_warehouse_id, p_destination_warehouse_id,
    'pending_receipt', v_uid, v_uid, now(), p_notes,
    false,
    jsonb_build_array(jsonb_build_object('event','created_and_sent','by',v_uid,'at',now()))
  ) RETURNING id INTO v_transfer_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (v_line->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO v_src_item FROM public.inventory_items
      WHERE id = (v_line->>'source_item_id')::uuid
        AND warehouse_id = p_source_warehouse_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'source_item_not_found: %', v_line->>'source_item_id'; END IF;
    IF v_src_item.stock < v_qty THEN
      RAISE EXCEPTION 'insufficient_stock: % (have %, need %)', v_src_item.name, v_src_item.stock, v_qty;
    END IF;
    SELECT * INTO v_dest_item FROM public.inventory_items
      WHERE warehouse_id = p_destination_warehouse_id
        AND trim(name) = trim(v_src_item.name)
      LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.inventory_items(
        warehouse_id, name, category, sku, unit, stock, low_stock_threshold, unit_cost
      ) VALUES (
        p_destination_warehouse_id, v_src_item.name, v_src_item.category, v_src_item.sku,
        v_src_item.unit, 0, v_src_item.low_stock_threshold, v_src_item.unit_cost
      ) RETURNING * INTO v_dest_item;
    END IF;
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity,
      destination_warehouse_id, unit_cost, performed_by, notes, reference, party
    ) VALUES (
      v_src_item.id, p_source_warehouse_id, 'transfer', v_qty,
      p_destination_warehouse_id, v_src_item.unit_cost, v_uid,
      'تحويل صادر (' || v_transfer_no || ')', v_transfer_no, v_party
    ) RETURNING id INTO v_src_mv_id;
    INSERT INTO public.warehouse_transfer_items(
      transfer_id, source_item_id, destination_item_id, item_name, unit,
      requested_qty, sent_qty, unit_cost, total_cost,
      source_movement_id, destination_movement_id, line_status
    ) VALUES (
      v_transfer_id, v_src_item.id, v_dest_item.id, v_src_item.name, v_src_item.unit,
      v_qty, v_qty, v_src_item.unit_cost, v_qty * COALESCE(v_src_item.unit_cost, 0),
      v_src_mv_id, NULL, 'pending'
    );
    v_lines_created := v_lines_created + 1;
  END LOOP;

  IF v_lines_created = 0 THEN RAISE EXCEPTION 'no_valid_lines'; END IF;

  RETURN jsonb_build_object('ok', true, 'transfer_id', v_transfer_id, 'transfer_no', v_transfer_no, 'lines', v_lines_created);
END;
$function$;

-- 5) Transfer finished product from a manufacturing invoice to a destination warehouse
CREATE OR REPLACE FUNCTION public.transfer_meat_invoice_to_warehouse(
  p_invoice_id uuid,
  p_destination_warehouse_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.meat_manufacturing_invoices%ROWTYPE;
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'production_manager'::app_role,
    'meat_factory_manager'::app_role,
    'warehouse_supervisor'::app_role
  ]) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  SELECT * INTO v_inv FROM public.meat_manufacturing_invoices
    WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF v_inv.status <> 'approved' THEN
    RAISE EXCEPTION 'invoice_not_approved_or_already_transferred: %', v_inv.status;
  END IF;
  IF v_inv.finished_item_id IS NULL THEN RAISE EXCEPTION 'no_finished_product'; END IF;

  v_res := public.create_and_send_transfer(
    v_inv.factory_warehouse_id,
    p_destination_warehouse_id,
    jsonb_build_array(jsonb_build_object(
      'source_item_id', v_inv.finished_item_id,
      'qty', v_inv.finished_qty
    )),
    COALESCE(p_notes, 'تحويل منتج تام من فاتورة تصنيع ' || v_inv.invoice_no)
  );

  UPDATE public.meat_manufacturing_invoices
    SET status = 'transferred',
        transferred_at = now(),
        transferred_by = v_uid,
        transfer_id = (v_res->>'transfer_id')::uuid,
        transfer_no = v_res->>'transfer_no',
        updated_at = now()
    WHERE id = p_invoice_id;

  RETURN v_res;
END;
$$;
