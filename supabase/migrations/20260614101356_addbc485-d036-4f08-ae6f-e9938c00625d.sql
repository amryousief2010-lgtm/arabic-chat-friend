
-- Unique customer lot per parent batch (idempotency for ensure_hatch_batch_lot)
CREATE UNIQUE INDEX IF NOT EXISTS uq_hatchery_batch_lots_batch_client
  ON public.hatchery_batch_lots(batch_id, client_id)
  WHERE client_id IS NOT NULL AND cancelled = false;

CREATE OR REPLACE FUNCTION public.ensure_hatch_batch_lot(p_hatch_batch_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row             public.hatch_batches%ROWTYPE;
  v_parent_id       uuid;
  v_parent_no       text;
  v_lot_id          uuid;
  v_eggs_in         integer;
  v_infertile       integer;
  v_completed_unh   integer;
  v_chicks          integer;
  v_hatcher_out     timestamptz;
BEGIN
  SELECT * INTO v_row FROM public.hatch_batches WHERE id = p_hatch_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hatch batch not found';
  END IF;

  IF v_row.operational_batch_no IS NULL OR v_row.operational_batch_no < 18 THEN
    RAISE EXCEPTION 'الحسابات متاحة فقط للدفعات من رقم 18 وما بعدها';
  END IF;

  IF v_row.customer_id IS NULL THEN
    RAISE EXCEPTION 'لا يوجد عميل مرتبط بهذه الدفعة';
  END IF;

  -- Map fields
  v_eggs_in       := COALESCE(v_row.net_eggs, v_row.received_eggs, 0);
  v_infertile     := COALESCE(v_row.candle1_infertile, 0);
  v_completed_unh := COALESCE(v_row.candle2_dead, 0);  -- "second-check unhatched" proxy
  v_chicks        := COALESCE(v_row.hatched_chicks, 0);
  v_hatcher_out   := CASE WHEN v_row.exit_date IS NOT NULL
                          THEN (v_row.exit_date::timestamp + interval '8 hours') AT TIME ZONE 'UTC'
                          ELSE NULL END;

  -- Parent operational batch: one per (operational_batch_no, machine)
  v_parent_no := 'OP-' || v_row.operational_batch_no::text
                 || COALESCE('-' || NULLIF(regexp_replace(v_row.machine, '\s+', '_', 'g'), ''), '');

  SELECT id INTO v_parent_id FROM public.hatchery_batches WHERE batch_number = v_parent_no;
  IF v_parent_id IS NULL THEN
    INSERT INTO public.hatchery_batches(batch_number, entry_date, batch_type, incubator_machine_no, status, created_by, notes)
    VALUES (v_parent_no,
            COALESCE(v_row.entry_date, v_row.receive_date, CURRENT_DATE),
            'mixed',
            v_row.machine,
            CASE WHEN v_row.status IN ('completed','closed') THEN 'completed' ELSE 'incubating' END,
            auth.uid(),
            'Auto-bridged from operational hatch batch #' || v_row.operational_batch_no::text)
    RETURNING id INTO v_parent_id;
  END IF;

  -- Existing lot for this (parent, client)?
  SELECT id INTO v_lot_id
  FROM public.hatchery_batch_lots
  WHERE batch_id = v_parent_id
    AND client_id = v_row.customer_id
    AND cancelled = false
  LIMIT 1;

  IF v_lot_id IS NULL THEN
    INSERT INTO public.hatchery_batch_lots(
      batch_id, owner_type, client_id, client_name_snapshot, source,
      eggs_in, infertile_eggs, completed_unhatched, chicks_hatched, hatcher_out_at
    )
    SELECT v_parent_id, 'external', v_row.customer_id,
           (SELECT name FROM public.hatch_customers WHERE id = v_row.customer_id),
           'operational_bridge',
           v_eggs_in, v_infertile, v_completed_unh, v_chicks, v_hatcher_out
    RETURNING id INTO v_lot_id;
  ELSE
    -- Refresh snapshot (only when invoice not yet issued)
    UPDATE public.hatchery_batch_lots
    SET eggs_in            = v_eggs_in,
        infertile_eggs     = v_infertile,
        completed_unhatched= v_completed_unh,
        chicks_hatched     = v_chicks,
        hatcher_out_at     = COALESCE(hatcher_out_at, v_hatcher_out),
        updated_at         = now()
    WHERE id = v_lot_id
      AND invoice_id IS NULL;
  END IF;

  RETURN v_lot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_hatch_batch_lot(uuid) TO authenticated;
