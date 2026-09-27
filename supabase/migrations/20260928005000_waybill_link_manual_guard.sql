-- A manual waybill (shipping_bill_source = 'manual') changes only through
-- set_order_waybill_manual. link_zodex_bill_to_order is SECURITY DEFINER, so its
-- UPDATE of orders runs as the function owner. lock_manual_waybill used to skip
-- that owner when auth.uid() is null, and a service_role call overwrote the bill
-- with no conflict row. Refuse that overwrite here, for every caller, the same
-- way sync_zodex_bill_no_to_order does: keep the manual bill, log the attempt,
-- and return a status the review screen already treats as a failure.
--
-- insert_waybill_sync_conflict is no longer executable by authenticated.
-- lock_manual_waybill calls it, so the trigger function is SECURITY DEFINER.
-- Inside that function current_user is the owner. The invoker is current_setting('role')
-- after SET ROLE (PostgREST and the service_role test), otherwise session_user.
-- A postgres/supabase_admin session with no JWT and no SET ROLE still skips the lock.

CREATE OR REPLACE FUNCTION public.insert_waybill_sync_conflict(
  p_order_id uuid,
  p_manual_bill_no text,
  p_incoming_bill_no text,
  p_source text,
  p_details jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.waybill_sync_conflicts
     WHERE order_id = p_order_id
       AND incoming_bill_no IS NOT DISTINCT FROM p_incoming_bill_no
       AND resolved_at IS NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.waybill_sync_conflicts
    (order_id, manual_bill_no, incoming_bill_no, source, details)
  VALUES
    (p_order_id, p_manual_bill_no, p_incoming_bill_no, p_source, p_details);
END;
$$;

REVOKE ALL ON FUNCTION public.insert_waybill_sync_conflict(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_waybill_sync_conflict(uuid, text, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.lock_manual_waybill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed boolean;
  v_blank boolean;
  v_actor text;
BEGIN
  -- SET ROLE (service_role / authenticated) survives inside this definer function.
  -- With no SET ROLE, the actor is the login user.
  v_actor := current_setting('role', true);
  IF v_actor IS NULL OR v_actor = '' OR v_actor = 'none' THEN
    v_actor := session_user;
  END IF;

  -- Migrations and maintenance run as the table owner with no JWT.
  IF v_actor IN ('postgres', 'supabase_admin') AND auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  allowed := current_setting('app.manual_waybill_rpc', true) = 'on'
    AND auth.uid() = '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1'::uuid;

  -- Anyone other than Alaa's RPC cannot set or clear the manual flag.
  IF NOT allowed AND (
       NEW.shipping_bill_source IS DISTINCT FROM OLD.shipping_bill_source
    OR NEW.shipping_bill_manual_by IS DISTINCT FROM OLD.shipping_bill_manual_by
    OR NEW.shipping_bill_manual_at IS DISTINCT FROM OLD.shipping_bill_manual_at
  ) THEN
    NEW.shipping_bill_source := OLD.shipping_bill_source;
    NEW.shipping_bill_manual_by := OLD.shipping_bill_manual_by;
    NEW.shipping_bill_manual_at := OLD.shipping_bill_manual_at;
  END IF;

  IF OLD.shipping_bill_source = 'manual'
     AND NOT allowed
     AND NEW.shipping_bill_no IS DISTINCT FROM OLD.shipping_bill_no
  THEN
    v_blank := NEW.shipping_bill_no IS NULL OR btrim(NEW.shipping_bill_no) = '';
    IF v_blank OR v_actor = 'service_role' OR auth.uid() IS NULL THEN
      PERFORM public.insert_waybill_sync_conflict(
        OLD.id,
        OLD.shipping_bill_no,
        NEW.shipping_bill_no,
        'direct_update_blocked',
        jsonb_build_object(
          'auth_uid', auth.uid(),
          'current_user', v_actor,
          'session_user', session_user,
          'tg_op', TG_OP
        )
      );
      NEW.shipping_bill_no := OLD.shipping_bill_no;
    ELSE
      RAISE EXCEPTION 'رقم البوليصة متسجل يدويًا ولا يعدله إلا م. آلاء'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_manual_waybill() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_manual_waybill() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.link_zodex_bill_to_order(
  p_bill_no text,
  p_order_id uuid,
  p_missing_id uuid DEFAULT NULL,
  p_match_score numeric DEFAULT NULL,
  p_match_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill text := trim(p_bill_no);
  v_existing_order_id uuid;
  v_previous_bill text;
  v_source text;
  v_user uuid := auth.uid();
  v_user_name text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::public.app_role,
    'executive_manager'::public.app_role,
    'warehouse_supervisor'::public.app_role,
    'agouza_warehouse_keeper'::public.app_role,
    'sales_manager'::public.app_role,
    'marketing_sales_manager'::public.app_role,
    'marketing_sales_viewer'::public.app_role,
    'financial_manager'::public.app_role,
    'accountant'::public.app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_bill IS NULL OR v_bill = '' THEN
    RAISE EXCEPTION 'رقم البوليصة مطلوب';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'رقم الأوردر مطلوب';
  END IF;

  SELECT id, shipping_bill_no, shipping_bill_source
    INTO v_existing_order_id, v_previous_bill, v_source
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF v_existing_order_id IS NULL THEN
    RAISE EXCEPTION 'الأوردر غير موجود';
  END IF;

  -- Same guard as sync_zodex_bill_no_to_order: a non-empty manual bill that
  -- differs from the incoming number is kept. An empty manual bill is not blocked.
  IF v_source = 'manual'
     AND v_previous_bill IS NOT NULL
     AND btrim(v_previous_bill) <> ''
     AND btrim(v_previous_bill) <> btrim(v_bill) THEN
    PERFORM public.insert_waybill_sync_conflict(
      p_order_id,
      v_previous_bill,
      v_bill,
      'link_zodex_bill_to_order',
      jsonb_build_object(
        'auth_uid', v_user,
        'current_user', current_user,
        'session_user', session_user
      )
    );
    RETURN jsonb_build_object(
      'ok', false,
      'status', 'manual_bill_kept',
      'error', 'رقم البوليصة متسجل يدويًا ولا يعدله إلا م. آلاء',
      'bill_no', v_previous_bill,
      'incoming_bill_no', v_bill,
      'order_id', p_order_id
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE shipping_bill_no = v_bill AND id <> p_order_id
  ) THEN
    RAISE EXCEPTION 'البوليصة % مربوطة بالفعل بأوردر آخر', v_bill;
  END IF;

  UPDATE public.orders
     SET shipping_bill_no = v_bill,
         updated_at = now()
   WHERE id = p_order_id;

  IF p_missing_id IS NOT NULL THEN
    UPDATE public.zodex_missing_orders
       SET status = 'resolved',
           resolved_order_id = p_order_id,
           resolved_by = v_user,
           resolved_at = now()
     WHERE id = p_missing_id;
  ELSE
    UPDATE public.zodex_missing_orders
       SET status = 'resolved',
           resolved_order_id = p_order_id,
           resolved_by = v_user,
           resolved_at = now()
     WHERE bill_no = v_bill AND status <> 'resolved';
  END IF;

  SELECT COALESCE(full_name, email) INTO v_user_name
    FROM public.profiles WHERE id = v_user;

  INSERT INTO public.zodex_bill_link_audit
    (bill_no, order_id, missing_id, linked_by, linked_by_name, match_score, match_reason, previous_bill_no)
  VALUES
    (v_bill, p_order_id, p_missing_id, v_user, v_user_name, p_match_score, p_match_reason, v_previous_bill);

  RETURN jsonb_build_object('ok', true, 'bill_no', v_bill, 'order_id', p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.link_zodex_bill_to_order(text, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_zodex_bill_to_order(text, uuid, uuid, numeric, text) TO authenticated, service_role;
