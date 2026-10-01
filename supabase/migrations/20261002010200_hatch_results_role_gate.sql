-- P0 Issue 5: only hatchery_manager (+ general/executive override) may enter final
-- hatch results or close batches (which post lab_customer_ledger receivables).

CREATE OR REPLACE FUNCTION public.can_manage_hatch_results(_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_any_role(
    _uid,
    ARRAY['hatchery_manager', 'general_manager', 'executive_manager']::app_role[]
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_hatch_results(uuid) TO authenticated;

-- Guard direct UPDATEs of result/close fields
CREATE OR REPLACE FUNCTION public.trg_guard_hatch_batch_results()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  results_changed boolean;
  closing boolean;
BEGIN
  IF COALESCE(current_setting('app.hatch_results_rpc', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  results_changed :=
       NEW.excluded_eggs IS DISTINCT FROM OLD.excluded_eggs
    OR NEW.candle1_infertile IS DISTINCT FROM OLD.candle1_infertile
    OR NEW.candle1_fertile IS DISTINCT FROM OLD.candle1_fertile
    OR NEW.candle2_dead IS DISTINCT FROM OLD.candle2_dead
    OR NEW.candle2_fertile IS DISTINCT FROM OLD.candle2_fertile
    OR NEW.hatcher_dead IS DISTINCT FROM OLD.hatcher_dead
    OR NEW.hatched_chicks IS DISTINCT FROM OLD.hatched_chicks
    OR NEW.net_eggs IS DISTINCT FROM OLD.net_eggs
    OR NEW.exit_date IS DISTINCT FROM OLD.exit_date;

  closing :=
    LOWER(COALESCE(NEW.status, '')) IN ('completed', 'closed')
    AND LOWER(COALESCE(OLD.status, '')) IS DISTINCT FROM LOWER(COALESCE(NEW.status, ''));

  IF (results_changed OR closing) AND NOT public.can_manage_hatch_results(auth.uid()) THEN
    RAISE EXCEPTION 'غير مسموح: إدخال نتائج الفقس أو إقفال الدفعة متاح فقط لمدير المعمل (أو المدير العام/التنفيذي).';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_hatch_batch_results ON public.hatch_batches;
CREATE TRIGGER trg_guard_hatch_batch_results
  BEFORE UPDATE ON public.hatch_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_guard_hatch_batch_results();

-- SECURITY DEFINER RPC used by HatchResultsEntryDialog
CREATE OR REPLACE FUNCTION public.save_or_close_hatching_batch_results(
  p_rows jsonb,
  p_closing boolean DEFAULT false,
  p_exit_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r jsonb;
  v_id uuid;
  v_excl int;
  v_c1 int;
  v_c2 int;
  v_hd int;
  v_ch int;
  v_notes text;
  v_eggs int;
  v_net int;
  v_updated int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF NOT public.can_manage_hatch_results(v_uid) THEN
    RAISE EXCEPTION 'غير مسموح: إدخال نتائج الفقس أو إقفال الدفعة متاح فقط لمدير المعمل (أو المدير العام/التنفيذي).';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'لا توجد صفوف للحفظ';
  END IF;
  IF p_closing AND p_exit_date IS NULL THEN
    RAISE EXCEPTION 'تاريخ الخروج مطلوب عند إقفال الدفعة';
  END IF;

  PERFORM set_config('app.hatch_results_rpc', 'on', true);

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_id := (r->>'id')::uuid;
    v_excl := COALESCE((r->>'excluded_eggs')::int, 0);
    v_c1 := COALESCE((r->>'candle1_infertile')::int, 0);
    v_c2 := COALESCE((r->>'candle2_dead')::int, 0);
    v_hd := COALESCE((r->>'hatcher_dead')::int, 0);
    v_ch := COALESCE((r->>'hatched_chicks')::int, 0);
    v_notes := NULLIF(r->>'notes', '');

    SELECT COALESCE(received_eggs, 0) INTO v_eggs FROM public.hatch_batches WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'دفعة غير موجودة: %', v_id;
    END IF;
    v_net := GREATEST(0, v_eggs - v_excl);

    IF p_closing THEN
      UPDATE public.hatch_batches SET
        excluded_eggs = v_excl,
        net_eggs = v_net,
        candle1_infertile = v_c1,
        candle1_fertile = GREATEST(0, v_net - v_c1),
        candle2_dead = v_c2,
        hatcher_dead = v_hd,
        hatched_chicks = v_ch,
        notes = COALESCE(v_notes, notes),
        exit_date = p_exit_date,
        status = 'completed',
        updated_at = now()
      WHERE id = v_id;
    ELSE
      UPDATE public.hatch_batches SET
        excluded_eggs = v_excl,
        net_eggs = v_net,
        candle1_infertile = v_c1,
        candle1_fertile = GREATEST(0, v_net - v_c1),
        candle2_dead = v_c2,
        hatcher_dead = v_hd,
        hatched_chicks = v_ch,
        notes = COALESCE(v_notes, notes),
        updated_at = now()
      WHERE id = v_id;
    END IF;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'updated', v_updated,
    'closing', p_closing,
    'exit_date', p_exit_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_or_close_hatching_batch_results(jsonb, boolean, date) TO authenticated;

COMMENT ON FUNCTION public.save_or_close_hatching_batch_results(jsonb, boolean, date) IS
  'P0 2026-10-02: role-gated save/close of hatch results (hatchery_manager + GM/EM). Posts receivables on close via existing trg_hatch_batch_to_ledger.';

-- Reopen also gated (GM/EM only — matches UI)
CREATE OR REPLACE FUNCTION public.reopen_hatching_batch_results(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['general_manager','executive_manager']::app_role[]) THEN
    RAISE EXCEPTION 'إعادة فتح الدفعة متاحة فقط للمدير العام أو المدير التنفيذي';
  END IF;
  PERFORM set_config('app.hatch_results_rpc', 'on', true);
  UPDATE public.hatch_batches
  SET status = 'received', exit_date = NULL, updated_at = now()
  WHERE id = ANY(p_ids);
  RETURN jsonb_build_object('ok', true, 'reopened', COALESCE(array_length(p_ids, 1), 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_hatching_batch_results(uuid[]) TO authenticated;
