-- Scratch scaffold mirroring production (coceg) objects as of 2026-10-12.
-- Used by supabase/tests/own_repeat_order_warning.sql. Run on a throwaway DB only.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.profile_directory (id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, phone text, phone2 text,
  address text, created_at timestamptz DEFAULT now());
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_number text, customer_id uuid REFERENCES public.customers(id),
  created_by uuid, status text, delivery_address text, shipping_company text, fulfillment_type text,
  total numeric DEFAULT 0, created_at timestamptz DEFAULT now());
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES public.orders(id),
  product_name text, offer_name text, quantity numeric, unit_price numeric);
CREATE TABLE public.duplicate_order_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requested_by uuid, customer_id uuid, status text,
  reason text, created_at timestamptz DEFAULT now(), decided_at timestamptz, matched_order_id uuid,
  duplicate_score numeric, expires_at timestamptz, resolved_order_id uuid);
CREATE TABLE public.duplicate_order_attempt_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempted_by uuid,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL, customer_phone text,
  matched_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  approval_id uuid REFERENCES public.duplicate_order_approvals(id) ON DELETE SET NULL,
  similarity_score numeric, proposed_order jsonb DEFAULT '{}'::jsonb, proposed_items jsonb DEFAULT '[]'::jsonb,
  matched_order_snapshot jsonb DEFAULT '{}'::jsonb, status text DEFAULT 'detected', decision_by uuid,
  decision_reason text, decided_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  CONSTRAINT duplicate_order_attempt_audit_status_check CHECK (status = ANY (ARRAY['detected','request_created','approved','rejected','saved_with_approval'])));

CREATE OR REPLACE FUNCTION public.normalize_phone_eg(input text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  s text := COALESCE(input, '');
BEGIN
  s := translate(s, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  s := regexp_replace(trim(s), '[^0-9+]', '', 'g');

  IF s LIKE '+20%' THEN
    s := substr(s, 4);
  ELSIF s LIKE '0020%' THEN
    s := substr(s, 5);
  ELSIF s ~ '^20[0-9]{10}$' THEN
    s := substr(s, 3);
  END IF;

  IF s ~ '^1[0-9]{9}$' THEN
    s := '0' || s;
  END IF;

  RETURN s;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_match_text(input text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT trim(regexp_replace(lower(COALESCE(input, '')), '\s+', ' ', 'g'));
$function$;

CREATE OR REPLACE FUNCTION public.order_items_signature_from_json(p_items jsonb)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT COALESCE(string_agg(DISTINCT public.normalize_match_text(COALESCE(NULLIF(elem->>'offer_name',''),NULLIF(elem->>'offerBoxName',''),NULLIF(elem->>'product_name',''),NULLIF(elem->>'name',''))), '|' ORDER BY public.normalize_match_text(COALESCE(NULLIF(elem->>'offer_name',''),NULLIF(elem->>'offerBoxName',''),NULLIF(elem->>'product_name',''),NULLIF(elem->>'name','')))), '')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) elem
  WHERE trim(COALESCE(NULLIF(elem->>'offer_name',''),NULLIF(elem->>'offerBoxName',''),NULLIF(elem->>'product_name',''),NULLIF(elem->>'name',''))) <> '';
$function$;

CREATE OR REPLACE FUNCTION public.order_items_signature_from_order(p_order_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(string_agg(DISTINCT public.normalize_match_text(COALESCE(NULLIF(oi.offer_name,''),oi.product_name)), '|' ORDER BY public.normalize_match_text(COALESCE(NULLIF(oi.offer_name,''),oi.product_name))), '')
  FROM public.order_items oi WHERE oi.order_id = p_order_id;
$function$;

CREATE OR REPLACE FUNCTION public.order_items_summary_from_order(p_order_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(string_agg(item_label, '، ' ORDER BY item_label), '')
  FROM (SELECT DISTINCT trim(COALESCE(NULLIF(oi.offer_name,''),oi.product_name)) || ' × ' || trim(to_char(oi.quantity,'FM999999990.##')) AS item_label
        FROM public.order_items oi WHERE oi.order_id = p_order_id) s;
$function$;


CREATE OR REPLACE FUNCTION public.find_duplicate_order_candidates(p_customer_id uuid, p_customer_name text, p_customer_phone text, p_delivery_address text DEFAULT NULL::text, p_shipping_company text DEFAULT NULL::text, p_fulfillment_type text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(matched_order_id uuid, order_number text, customer_name text, customer_phone text, moderator_name text, created_at timestamp with time zone, status text, delivery_address text, shipping_company text, fulfillment_type text, products_summary text, similarity_score numeric, matched_on_phone boolean, matched_on_same_day boolean, matched_on_items boolean, matched_on_address boolean, matched_on_shipping boolean, matched_on_name boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text := public.normalize_phone_eg(p_customer_phone);
  v_name text := public.normalize_match_text(p_customer_name);
  v_address text := public.normalize_match_text(p_delivery_address);
  v_shipping text := public.normalize_match_text(p_shipping_company);
  v_item_sig text := public.order_items_signature_from_json(p_items);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  RETURN QUERY
  WITH recent_orders AS (
    SELECT
      o.id AS o_id,
      o.order_number AS o_order_number,
      o.created_at AS o_created_at,
      o.status AS o_status,
      COALESCE(o.delivery_address, c.address) AS effective_delivery_address,
      o.shipping_company AS o_shipping_company,
      o.fulfillment_type AS o_fulfillment_type,
      c.name AS existing_customer_name,
      COALESCE(NULLIF(c.phone, ''), c.phone2) AS existing_customer_phone,
      public.normalize_phone_eg(c.phone) AS phone1_norm,
      public.normalize_phone_eg(c.phone2) AS phone2_norm,
      public.normalize_match_text(c.name) AS name_norm,
      public.normalize_match_text(COALESCE(o.delivery_address, c.address)) AS address_norm,
      public.normalize_match_text(COALESCE(o.shipping_company, '')) AS shipping_norm,
      public.order_items_signature_from_order(o.id) AS item_sig,
      public.order_items_summary_from_order(o.id) AS items_summary,
      pd.full_name AS existing_moderator_name,
      ((timezone('Africa/Cairo', o.created_at))::date = (timezone('Africa/Cairo', now()))::date) AS same_day
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.profile_directory pd ON pd.id = o.created_by
    WHERE COALESCE(o.status, '') <> 'cancelled'
      AND o.created_by IS DISTINCT FROM v_uid
      AND (
        o.created_at >= now() - interval '24 hours'
        OR date_trunc('month', timezone('Africa/Cairo', o.created_at))
           = date_trunc('month', timezone('Africa/Cairo', now()))
      )
  ),
  scored AS (
    SELECT
      ro.*,
      (v_phone <> '' AND (ro.phone1_norm = v_phone OR ro.phone2_norm = v_phone)) AS match_phone,
      ro.same_day AS match_same_day,
      (v_item_sig <> '' AND ro.item_sig <> '' AND ro.item_sig = v_item_sig) AS match_items,
      (v_address <> '' AND ro.address_norm <> '' AND (
        ro.address_norm = v_address
        OR ro.address_norm LIKE '%' || v_address || '%'
        OR v_address LIKE '%' || ro.address_norm || '%'
      )) AS match_address,
      (v_shipping <> '' AND ro.shipping_norm <> '' AND ro.shipping_norm = v_shipping) AS match_shipping,
      (v_name <> '' AND ro.name_norm <> '' AND (
        ro.name_norm = v_name
        OR ro.name_norm LIKE '%' || v_name || '%'
        OR v_name LIKE '%' || ro.name_norm || '%'
      )) AS match_name
    FROM recent_orders ro
  )
  SELECT
    s.o_id, s.o_order_number, s.existing_customer_name, s.existing_customer_phone,
    s.existing_moderator_name, s.o_created_at, s.o_status, s.effective_delivery_address,
    s.o_shipping_company, s.o_fulfillment_type, s.items_summary,
    CASE
      WHEN s.match_phone THEN 100::numeric
      ELSE round((
        CASE WHEN s.match_name THEN 40 ELSE 0 END +
        CASE WHEN s.match_address THEN 40 ELSE 0 END +
        CASE WHEN s.match_same_day THEN 10 ELSE 0 END +
        CASE WHEN s.match_items THEN 5 ELSE 0 END +
        CASE WHEN s.match_shipping THEN 3 ELSE 0 END
      )::numeric, 2)
    END AS score,
    s.match_phone, s.match_same_day, s.match_items, s.match_address, s.match_shipping, s.match_name
  FROM scored s
  WHERE
    s.match_phone
    OR (s.match_same_day AND s.match_name AND s.match_address)
  ORDER BY score DESC, s.o_created_at DESC
  LIMIT 10;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_duplicate_order_attempt(p_customer_id uuid, p_customer_name text, p_customer_phone text, p_delivery_address text DEFAULT NULL::text, p_shipping_company text DEFAULT NULL::text, p_fulfillment_type text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_candidates jsonb := '[]'::jsonb;
  v_top record;
  v_attempt_id uuid;
  v_existing public.duplicate_order_approvals;
  v_proposed_order jsonb;
  v_item_sig text := public.order_items_signature_from_json(p_items);
  v_double_submit_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT o.id INTO v_double_submit_id
  FROM public.orders o
  WHERE o.customer_id = p_customer_id
    AND o.created_by = v_uid
    AND COALESCE(o.status, '') <> 'cancelled'
    AND o.created_at >= now() - interval '2 minutes'
    AND public.order_items_signature_from_order(o.id) = v_item_sig
  LIMIT 1;

  IF v_double_submit_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'is_duplicate', false,
      'is_double_submit', true,
      'double_submit_order_id', v_double_submit_id,
      'candidates', '[]'::jsonb,
      'attempt_id', NULL
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'matched_order_id', c.matched_order_id,
        'order_number', c.order_number,
        'customer_name', c.customer_name,
        'customer_phone', c.customer_phone,
        'moderator_name', c.moderator_name,
        'created_at', c.created_at,
        'status', c.status,
        'delivery_address', c.delivery_address,
        'shipping_company', c.shipping_company,
        'fulfillment_type', c.fulfillment_type,
        'products_summary', c.products_summary,
        'similarity_score', c.similarity_score,
        'matched_on_phone', c.matched_on_phone,
        'matched_on_same_day', c.matched_on_same_day,
        'matched_on_items', c.matched_on_items,
        'matched_on_address', c.matched_on_address,
        'matched_on_shipping', c.matched_on_shipping,
        'matched_on_name', c.matched_on_name
      )
      ORDER BY c.similarity_score DESC, c.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_candidates
  FROM public.find_duplicate_order_candidates(
    p_customer_id, p_customer_name, p_customer_phone,
    p_delivery_address, p_shipping_company, p_fulfillment_type, p_items
  ) c;

  IF jsonb_array_length(v_candidates) = 0 THEN
    RETURN jsonb_build_object(
      'is_duplicate', false,
      'is_double_submit', false,
      'candidates', '[]'::jsonb,
      'attempt_id', NULL
    );
  END IF;

  SELECT *
  INTO v_top
  FROM public.find_duplicate_order_candidates(
    p_customer_id, p_customer_name, p_customer_phone,
    p_delivery_address, p_shipping_company, p_fulfillment_type, p_items
  )
  LIMIT 1;

  v_proposed_order := jsonb_build_object(
    'customer_name', p_customer_name,
    'customer_phone', public.normalize_phone_eg(p_customer_phone),
    'delivery_address', p_delivery_address,
    'shipping_company', p_shipping_company,
    'fulfillment_type', p_fulfillment_type,
    'note', p_note
  );

  INSERT INTO public.duplicate_order_attempt_audit (
    attempted_by, customer_id, customer_phone, matched_order_id,
    similarity_score, proposed_order, proposed_items, matched_order_snapshot, status
  )
  VALUES (
    v_uid, p_customer_id, public.normalize_phone_eg(p_customer_phone),
    v_top.matched_order_id, v_top.similarity_score,
    v_proposed_order, COALESCE(p_items, '[]'::jsonb), to_jsonb(v_top), 'detected'
  )
  RETURNING id INTO v_attempt_id;

  SELECT *
  INTO v_existing
  FROM public.duplicate_order_approvals
  WHERE requested_by = v_uid
    AND customer_id = p_customer_id
    AND expires_at > now()
    AND (status <> 'approved' OR resolved_order_id IS NULL)
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'is_duplicate', true,
    'is_double_submit', false,
    'attempt_id', v_attempt_id,
    'candidates', v_candidates,
    'existing_request', CASE
      WHEN v_existing.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_existing.id,
        'status', v_existing.status,
        'reason', v_existing.reason,
        'created_at', v_existing.created_at,
        'decided_at', v_existing.decided_at,
        'matched_order_id', v_existing.matched_order_id,
        'duplicate_score', v_existing.duplicate_score
      )
    END
  );
END;
$function$
;
GRANT EXECUTE ON FUNCTION public.check_duplicate_order_attempt(uuid, text, text, text, text, text, jsonb, text) TO anon;
