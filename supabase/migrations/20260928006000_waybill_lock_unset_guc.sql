-- lock_manual_waybill treated an unset app.manual_waybill_rpc as "allowed".
-- current_setting(..., true) returns NULL when the GUC was never defined on the
-- connection, and NULL = 'on' is NULL, so `IF NOT allowed` does not run. A
-- service_role UPDATE (auth.uid() is also NULL) then wrote shipping_bill_no and
-- shipping_bill_source with no conflict row. coalesce makes that case false.
--
-- Allowed only for Alaa's RPC: the GUC is on AND auth.uid() is Alaa.
-- service_role / no-JWT sessions that touch a manual bill are not raised: the
-- manual columns stay as they were, one unresolved conflict is logged, and any
-- other column in the same UPDATE still changes.
-- The maintenance skip is only an explicit postgres / supabase_admin role with
-- no JWT. service_role is not that role.

CREATE UNIQUE INDEX IF NOT EXISTS waybill_sync_conflicts_open_incoming_uidx
  ON public.waybill_sync_conflicts (order_id, incoming_bill_no)
  NULLS NOT DISTINCT
  WHERE resolved_at IS NULL;

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
  INSERT INTO public.waybill_sync_conflicts
    (order_id, manual_bill_no, incoming_bill_no, source, details)
  VALUES
    (p_order_id, p_manual_bill_no, p_incoming_bill_no, p_source, p_details)
  ON CONFLICT (order_id, incoming_bill_no) WHERE resolved_at IS NULL DO NOTHING;
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
  v_jwt_role text;
  v_incoming text;
  v_bill_changed boolean;
  v_flag_changed boolean;
BEGIN
  v_actor := current_setting('role', true);
  IF v_actor IS NULL OR v_actor = '' OR v_actor = 'none' THEN
    v_actor := nullif(current_setting('request.jwt.claim.role', true), '');
  END IF;
  IF v_actor IS NULL OR v_actor = '' THEN
    v_actor := session_user;
  END IF;
  v_jwt_role := coalesce(current_setting('request.jwt.claim.role', true), '');

  -- Migrations and maintenance. Not service_role, even when the login user is
  -- postgres / supabase_admin and the JWT role says service_role.
  IF v_actor IN ('postgres', 'supabase_admin')
     AND v_jwt_role IS DISTINCT FROM 'service_role'
     AND auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  allowed := coalesce(current_setting('app.manual_waybill_rpc', true), '') = 'on'
    AND auth.uid() = '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1'::uuid;

  v_incoming := NEW.shipping_bill_no;
  v_bill_changed := NEW.shipping_bill_no IS DISTINCT FROM OLD.shipping_bill_no;
  v_flag_changed := NEW.shipping_bill_source IS DISTINCT FROM OLD.shipping_bill_source
    OR NEW.shipping_bill_manual_by IS DISTINCT FROM OLD.shipping_bill_manual_by
    OR NEW.shipping_bill_manual_at IS DISTINCT FROM OLD.shipping_bill_manual_at;

  -- Anyone other than Alaa's RPC cannot set or clear the manual flag.
  IF NOT allowed AND v_flag_changed THEN
    NEW.shipping_bill_source := OLD.shipping_bill_source;
    NEW.shipping_bill_manual_by := OLD.shipping_bill_manual_by;
    NEW.shipping_bill_manual_at := OLD.shipping_bill_manual_at;
  END IF;

  IF OLD.shipping_bill_source = 'manual'
     AND NOT allowed
     AND (v_bill_changed OR v_flag_changed)
  THEN
    IF v_actor = 'service_role' OR v_jwt_role = 'service_role' OR auth.uid() IS NULL THEN
      PERFORM public.insert_waybill_sync_conflict(
        OLD.id,
        OLD.shipping_bill_no,
        v_incoming,
        'direct_update_blocked',
        jsonb_build_object(
          'auth_uid', auth.uid(),
          'current_user', v_actor,
          'session_user', session_user,
          'tg_op', TG_OP
        )
      );
      NEW.shipping_bill_no := OLD.shipping_bill_no;
      NEW.shipping_bill_source := OLD.shipping_bill_source;
      NEW.shipping_bill_manual_by := OLD.shipping_bill_manual_by;
      NEW.shipping_bill_manual_at := OLD.shipping_bill_manual_at;
    ELSIF v_bill_changed THEN
      v_blank := v_incoming IS NULL OR btrim(v_incoming) = '';
      IF v_blank THEN
        PERFORM public.insert_waybill_sync_conflict(
          OLD.id,
          OLD.shipping_bill_no,
          v_incoming,
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
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_manual_waybill() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_manual_waybill() TO authenticated, service_role;

-- Same direct insert as sync_zodex_bill_no_to_order, plus the race-safe conflict target.
CREATE OR REPLACE FUNCTION public.sync_zodex_bill_no_to_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill text;
  v_source text;
BEGIN
  IF NEW.order_id IS NOT NULL AND NEW.bill_no IS NOT NULL AND NEW.bill_no <> '' THEN
    SELECT shipping_bill_no, shipping_bill_source
      INTO v_bill, v_source
      FROM public.orders
     WHERE id = NEW.order_id;

    IF v_source = 'manual'
       AND v_bill IS NOT NULL
       AND btrim(v_bill) <> ''
       AND btrim(v_bill) <> btrim(NEW.bill_no) THEN
      INSERT INTO public.waybill_sync_conflicts
        (order_id, manual_bill_no, incoming_bill_no, source)
      VALUES
        (NEW.order_id, v_bill, NEW.bill_no, 'zodex_closed_invoice_trigger')
      ON CONFLICT (order_id, incoming_bill_no) WHERE resolved_at IS NULL DO NOTHING;
    ELSE
      UPDATE public.orders
        SET shipping_bill_no = NEW.bill_no
      WHERE id = NEW.order_id
        AND (shipping_bill_no IS NULL OR shipping_bill_no = '' OR shipping_bill_no <> NEW.bill_no);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_zodex_bill_no_to_order() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_zodex_bill_no_to_order() TO authenticated, service_role;
