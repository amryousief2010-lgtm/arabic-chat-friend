-- Zodex sync runs as service_role and must not change delivery status on a
-- manual waybill. Other service_role writers (process-bostta-delivery) must
-- still mark the order delivered. Staff with a JWT still update status
-- through the app.
--
-- The status lock runs only when the same UPDATE touches a Zodex-only column:
--   zodex_synced_at or zodex_return_amount (sync-zodex-deliveries), or
--   update_status_marker or update_status_updated_at (sync-zodex-shipments
--   cancel, which does not set zodex_synced_at).
-- Bostta sets status, delivered_at, total, stock_status, stock_router_log
-- and does not touch those columns.
--
-- Locked columns, when that discriminator matches:
--   status, collection_status, delivered_at, total_at_delivery,
--   zodex_return_amount, update_status_marker, update_status_updated_at.
-- zodex_synced_at and notes still change. shipping_bill_no stays on the
-- existing bill guard. One unresolved conflict per (order, incoming bill);
-- the attempted status is details.ignored_status.

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
  v_silent boolean;
  v_zodex_sync boolean;
  v_log_silent boolean := false;
  v_attempted_status text;
  v_ignored_cols text[] := ARRAY[]::text[];
  v_details jsonb;
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

  v_silent := v_actor = 'service_role'
    OR v_jwt_role = 'service_role'
    OR auth.uid() IS NULL;

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
    IF v_silent THEN
      v_log_silent := true;
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

  -- Zodex sync only. A service_role delivery that does not touch a Zodex
  -- column (Bostta) is left alone. Authenticated staff are not v_silent.
  v_zodex_sync := NEW.zodex_synced_at IS DISTINCT FROM OLD.zodex_synced_at
    OR NEW.zodex_return_amount IS DISTINCT FROM OLD.zodex_return_amount
    OR NEW.update_status_marker IS DISTINCT FROM OLD.update_status_marker
    OR NEW.update_status_updated_at IS DISTINCT FROM OLD.update_status_updated_at;

  IF OLD.shipping_bill_source = 'manual' AND v_silent AND v_zodex_sync THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_attempted_status := NEW.status;
      v_ignored_cols := array_append(v_ignored_cols, 'status');
      NEW.status := OLD.status;
    END IF;
    IF NEW.collection_status IS DISTINCT FROM OLD.collection_status THEN
      v_ignored_cols := array_append(v_ignored_cols, 'collection_status');
      NEW.collection_status := OLD.collection_status;
    END IF;
    IF NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
      v_ignored_cols := array_append(v_ignored_cols, 'delivered_at');
      NEW.delivered_at := OLD.delivered_at;
    END IF;
    IF NEW.total_at_delivery IS DISTINCT FROM OLD.total_at_delivery THEN
      v_ignored_cols := array_append(v_ignored_cols, 'total_at_delivery');
      NEW.total_at_delivery := OLD.total_at_delivery;
    END IF;
    IF NEW.zodex_return_amount IS DISTINCT FROM OLD.zodex_return_amount THEN
      v_ignored_cols := array_append(v_ignored_cols, 'zodex_return_amount');
      NEW.zodex_return_amount := OLD.zodex_return_amount;
    END IF;
    IF NEW.update_status_marker IS DISTINCT FROM OLD.update_status_marker THEN
      v_ignored_cols := array_append(v_ignored_cols, 'update_status_marker');
      NEW.update_status_marker := OLD.update_status_marker;
    END IF;
    IF NEW.update_status_updated_at IS DISTINCT FROM OLD.update_status_updated_at THEN
      v_ignored_cols := array_append(v_ignored_cols, 'update_status_updated_at');
      NEW.update_status_updated_at := OLD.update_status_updated_at;
    END IF;
    IF cardinality(v_ignored_cols) > 0 THEN
      v_log_silent := true;
    END IF;
  END IF;

  IF v_log_silent THEN
    v_details := jsonb_build_object(
      'auth_uid', auth.uid(),
      'current_user', v_actor,
      'session_user', session_user,
      'tg_op', TG_OP
    );
    IF cardinality(v_ignored_cols) > 0 THEN
      v_details := v_details || jsonb_build_object(
        'ignored_status', v_attempted_status,
        'ignored_columns', to_jsonb(v_ignored_cols)
      );
    END IF;
    PERFORM public.insert_waybill_sync_conflict(
      OLD.id,
      OLD.shipping_bill_no,
      v_incoming,
      'direct_update_blocked',
      v_details
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_manual_waybill() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_manual_waybill() TO authenticated, service_role;
