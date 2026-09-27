-- Alaa (77b71c5f-cfa8-42bc-85de-ae536a3ec1c1) may replace a waybill on Cairo/Giza orders.
-- Null shipping_bill_source stays the legacy/courier path. No backfill.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_bill_source text,
  ADD COLUMN IF NOT EXISTS shipping_bill_manual_by uuid,
  ADD COLUMN IF NOT EXISTS shipping_bill_manual_at timestamptz;

-- Clients must not flip the manual flag; only set_order_waybill_manual writes it.
REVOKE UPDATE (shipping_bill_source, shipping_bill_manual_by, shipping_bill_manual_at)
  ON public.orders FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.normalize_governorate(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
    translate(
      replace(replace(replace(btrim(coalesce(p_text, '')), 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'),
      'ةىـ',
      'هي'
    ),
    '[[:space:][:punct:]،؛؟]+',
    '',
    'g'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_governorate(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_governorate(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.waybill_sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  manual_bill_no text,
  incoming_bill_no text,
  source text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);

ALTER TABLE public.waybill_sync_conflicts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.waybill_sync_conflicts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.waybill_sync_conflicts TO authenticated;
GRANT ALL ON TABLE public.waybill_sync_conflicts TO service_role;

DROP POLICY IF EXISTS waybill_sync_conflicts_select ON public.waybill_sync_conflicts;
CREATE POLICY waybill_sync_conflicts_select
  ON public.waybill_sync_conflicts
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1'::uuid
    OR public.has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager']::public.app_role[])
  );

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

-- Current body of sync_zodex_bill_no_to_order (20260705182136) plus the manual guard.
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
        (NEW.order_id, v_bill, NEW.bill_no, 'zodex_closed_invoice_trigger');
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
