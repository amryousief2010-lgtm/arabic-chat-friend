-- A manual waybill (shipping_bill_source = 'manual') changes only when Alaa calls
-- set_order_waybill_manual. That function sets app.manual_waybill_rpc for the
-- transaction, then updates. Every other writer is handled by trg_lock_manual_waybill.
--
-- Existing BEFORE UPDATE triggers on public.orders, alphabetical (the order they fire):
--   orders_set_source_warehouse              UPDATE OF shipping_company
--   trg_00_reject_premature_dispatched       UPDATE OF stock_status
--   trg_enforce_order_fulfillment_source     UPDATE OF fulfillment_type, source_warehouse_id, shipping_company
--   trg_lock_manual_waybill                  UPDATE (this migration; all columns)
--   trg_set_order_delivered_at               UPDATE
--   trg_validate_mixed_payment_breakdown     UPDATE OF the collection amount columns
--   trg_validate_order_collection_method     UPDATE OF collection_method
--   update_orders_updated_at                 UPDATE
-- None of those functions read or write shipping_bill_no or the manual-flag columns.
-- The lock therefore runs before delivered_at / updated_at, and those later triggers
-- see the bill number after a blocked change has been put back. The three earlier
-- triggers run only when their own columns are in the UPDATE, and they do not look
-- at the waybill.
-- sync_zodex_bill_no_to_order is SECURITY DEFINER on zodex_closed_invoice_orders.
-- Its UPDATE of orders runs as the function owner (postgres / supabase_admin). With
-- no JWT that hits the maintenance skip below. That function already refuses to
-- replace a non-empty manual bill before it issues the UPDATE.

CREATE OR REPLACE FUNCTION public.set_order_waybill_manual(p_order_id uuid, p_bill_no text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_bill text := btrim(coalesce(p_bill_no, ''));
  v_old text;
  v_gov text;
  v_norm text;
  v_name text;
BEGIN
  IF v_uid IS DISTINCT FROM '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1'::uuid THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT o.shipping_bill_no, c.governorate
    INTO v_old, v_gov
    FROM public.orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
   WHERE o.id = p_order_id
   FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  v_norm := public.normalize_governorate(v_gov);
  IF v_norm NOT IN ('القاهره', 'قاهره', 'الجيزه', 'جيزه')
     AND regexp_replace(v_norm, '^ال', '') NOT IN ('قاهره', 'جيزه') THEN
    RAISE EXCEPTION 'NOT_ALLOWED_GOVERNORATE';
  END IF;

  IF v_bill = '' THEN
    RAISE EXCEPTION 'EMPTY_BILL';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.orders
     WHERE id <> p_order_id
       AND shipping_bill_no IS NOT NULL
       AND lower(btrim(shipping_bill_no)) = lower(v_bill)
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_WAYBILL';
  END IF;

  IF v_old IS NOT NULL AND btrim(v_old) = v_bill THEN
    RETURN json_build_object('order_id', p_order_id, 'old_bill_no', v_old, 'new_bill_no', v_bill);
  END IF;

  PERFORM set_config('app.manual_waybill_rpc','on', true);

  UPDATE public.orders
     SET shipping_bill_no = v_bill,
         shipping_bill_source = 'manual',
         shipping_bill_manual_by = v_uid,
         shipping_bill_manual_at = now()
   WHERE id = p_order_id;

  SELECT COALESCE(full_name, email) INTO v_name
    FROM public.profiles
   WHERE id = v_uid;

  INSERT INTO public.zodex_bill_link_audit
    (bill_no, order_id, linked_by, linked_by_name, match_reason, previous_bill_no)
  VALUES
    (v_bill, p_order_id, v_uid, v_name, 'manual', v_old);

  RETURN json_build_object('order_id', p_order_id, 'old_bill_no', v_old, 'new_bill_no', v_bill);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_order_waybill_manual(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_waybill_manual(uuid, text) TO authenticated;

-- Invoker updates cannot insert into waybill_sync_conflicts (RLS, no INSERT grant).
CREATE OR REPLACE FUNCTION public.insert_waybill_sync_conflict(
  p_order_id uuid,
  p_manual_bill_no text,
  p_incoming_bill_no text,
  p_source text,
  p_details jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.waybill_sync_conflicts
    (order_id, manual_bill_no, incoming_bill_no, source, details)
  VALUES
    (p_order_id, p_manual_bill_no, p_incoming_bill_no, p_source, p_details);
$$;

REVOKE ALL ON FUNCTION public.insert_waybill_sync_conflict(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_waybill_sync_conflict(uuid, text, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lock_manual_waybill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  allowed boolean;
  v_blank boolean;
BEGIN
  -- Migrations and maintenance run as the table owner with no JWT.
  IF current_user IN ('postgres', 'supabase_admin') AND auth.uid() IS NULL THEN
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
    IF v_blank OR current_user = 'service_role' OR auth.uid() IS NULL THEN
      PERFORM public.insert_waybill_sync_conflict(
        OLD.id,
        OLD.shipping_bill_no,
        NEW.shipping_bill_no,
        'direct_update_blocked',
        jsonb_build_object(
          'auth_uid', auth.uid(),
          'current_user', current_user,
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

DROP TRIGGER IF EXISTS trg_lock_manual_waybill ON public.orders;
CREATE TRIGGER trg_lock_manual_waybill
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_manual_waybill();
