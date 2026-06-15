
ALTER TABLE public.warehouse_opening_balances
  ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_value numeric GENERATED ALWAYS AS (qty * unit_cost) STORED,
  ADD COLUMN IF NOT EXISTS counted_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS posted_movement_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_opening_balance_wh_item
  ON public.warehouse_opening_balances(warehouse_id, item_id);

CREATE OR REPLACE FUNCTION public.autofill_inventory_reference_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reference_id IS NULL OR length(btrim(NEW.reference_id)) = 0 THEN
    NEW.reference_id := COALESCE(NEW.module, 'inv') || '_' ||
                        NEW.movement_type || '_' ||
                        NEW.warehouse_id::text || '_' ||
                        COALESCE(NEW.item_id::text, 'noitem') || '_' ||
                        to_char(COALESCE(NEW.performed_at, now()), 'YYYYMMDDHH24MISSMS') || '_' ||
                        substr(NEW.id::text, 1, 8);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_a_autofill_reference_id ON public.inventory_movements;
CREATE TRIGGER trg_a_autofill_reference_id
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.autofill_inventory_reference_id();

CREATE OR REPLACE FUNCTION public.approve_warehouse_opening_balance(p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ob public.warehouse_opening_balances%ROWTYPE;
  v_ref text;
  v_existing uuid;
  v_mov_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (public.has_role(v_uid, 'general_manager'::app_role) OR public.has_role(v_uid, 'executive_manager'::app_role)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: فقط المدير العام أو التنفيذي يعتمد الرصيد الافتتاحي';
  END IF;
  SELECT * INTO v_ob FROM public.warehouse_opening_balances WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_ob.status = 'approved' THEN RETURN v_ob.posted_movement_id; END IF;

  v_ref := 'opening_balance_' || v_ob.warehouse_id::text || '_' || v_ob.item_id::text || '_' ||
           to_char(COALESCE(v_ob.opened_at, now()), 'YYYYMMDD');

  -- Idempotency: skip insert if same opening_balance reference already exists.
  SELECT id INTO v_existing FROM public.inventory_movements
   WHERE reference_id = v_ref AND movement_type='opening_balance' AND item_id = v_ob.item_id
   LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity, unit_cost,
      performed_by, performed_at, module, reference_type, reference_id,
      approval_status, notes
    ) VALUES (
      v_ob.item_id, v_ob.warehouse_id, 'opening_balance', v_ob.qty, COALESCE(v_ob.unit_cost,0),
      v_uid, COALESCE(v_ob.opened_at, now()), 'warehouse', 'opening_balance', v_ref,
      'posted', COALESCE(v_ob.notes,'') || ' [opening_balance approved]'
    ) RETURNING id INTO v_mov_id;
  ELSE
    v_mov_id := v_existing;
  END IF;

  UPDATE public.inventory_items
    SET stock = v_ob.qty,
        unit_cost = CASE WHEN COALESCE(v_ob.unit_cost,0) > 0 THEN v_ob.unit_cost ELSE unit_cost END,
        last_movement_date = now()
    WHERE id = v_ob.item_id;

  UPDATE public.warehouse_opening_balances
    SET status='approved', approved_by=v_uid, approved_at=now(),
        posted_movement_id=v_mov_id, updated_at=now()
    WHERE id = p_id;

  RETURN v_mov_id;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_warehouse_opening_balance(uuid) TO authenticated;
