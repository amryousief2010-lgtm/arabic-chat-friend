-- Duplicate-order window: rolling 7 days OR the same Africa/Cairo calendar month.
--
-- Approved by Amr: replace the short rolling window with 7 days and keep the
-- same-month rule. Source of truth for the previous bodies is coceg-prod
-- (pg_get_functiondef, 2026-11-02), not older files in supabase/migrations.
--
-- Before (live):
--   find_duplicate_order_candidates, find_own_repeat_order_candidates:
--     created_at >= now() - interval '24 hours'
--     OR same Africa/Cairo calendar month as now()
--   customer_has_other_order_this_month (called by enforce_duplicate_order_approval):
--     same Africa/Cairo calendar month as now() only (no 24h clause in production)
--   notify_duplicate_customer_order_monthly:
--     same Africa/Cairo calendar month as NEW.created_at only,
--     and exact text equality on customers.phone (phone2 ignored)
--
-- After:
--   find_duplicate_order_candidates, find_own_repeat_order_candidates,
--   customer_has_other_order_this_month:
--     created_at >= now() - interval '7 days'
--     OR same Africa/Cairo calendar month as now()
--   notify_duplicate_customer_order_monthly:
--     created_at >= NEW.created_at - interval '7 days'
--     OR same Africa/Cairo calendar month as NEW.created_at
--     phone match: normalize_phone_eg(phone) and normalize_phone_eg(phone2)
--     on the new customer against both columns of the earlier customer
--
-- Unchanged: non-cancelled only, different creator (cross-moderator functions),
-- phone score 100, approval flow, roles, signatures, SECURITY DEFINER,
-- STABLE where it was STABLE, search_path = public. Customer-record creation
-- is not touched. The enforce trigger is not attached in production and this
-- migration does not create it.
--
-- Idempotent: CREATE OR REPLACE only, same argument lists. CREATE OR REPLACE
-- keeps ownership and ACLs; the GRANT/REVOKE block restates the coceg-prod
-- ACLs queried on 2026-11-02 so a fresh database matches production.
--   find_duplicate_order_candidates, customer_has_other_order_this_month,
--   notify_duplicate_customer_order_monthly:
--     anon, authenticated, service_role (PUBLIC revoked)
--   find_own_repeat_order_candidates:
--     authenticated, service_role only (anon and PUBLIC revoked)
--
-- Rollback: run supabase/rollbacks/20261102220000_duplicate_order_rolling_7d.sql
-- (not under supabase/migrations, so the CLI will not apply it). That file is
-- the previous production definitions. Grants are preserved by CREATE OR REPLACE.

-- find_duplicate_order_candidates
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
        o.created_at >= now() - interval '7 days'
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

-- customer_has_other_order_this_month
CREATE OR REPLACE FUNCTION public.customer_has_other_order_this_month(p_customer_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target_customer AS (
    SELECT public.normalize_phone_eg(phone) AS phone1, public.normalize_phone_eg(phone2) AS phone2
    FROM public.customers
    WHERE id = p_customer_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    CROSS JOIN target_customer tc
    WHERE COALESCE(o.status, '') <> 'cancelled'
      AND o.created_by IS DISTINCT FROM p_user_id
      AND (
        o.created_at >= now() - interval '7 days'
        OR date_trunc('month', timezone('Africa/Cairo', o.created_at))
           = date_trunc('month', timezone('Africa/Cairo', now()))
      )
      AND (
        (NULLIF(tc.phone1,'') IS NOT NULL AND public.normalize_phone_eg(c.phone) = tc.phone1)
        OR (NULLIF(tc.phone2,'') IS NOT NULL AND public.normalize_phone_eg(c.phone) = tc.phone2)
        OR (NULLIF(tc.phone1,'') IS NOT NULL AND public.normalize_phone_eg(c.phone2) = tc.phone1)
        OR (NULLIF(tc.phone2,'') IS NOT NULL AND public.normalize_phone_eg(c.phone2) = tc.phone2)
      )
  );
$function$
;

-- notify_duplicate_customer_order_monthly
CREATE OR REPLACE FUNCTION public.notify_duplicate_customer_order_monthly()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone_raw text;
  v_phone2_raw text;
  v_phone text;
  v_phone2 text;
  v_name  text;
  v_prev_count int;
  v_month_start timestamptz;
  v_month_end   timestamptz;
BEGIN
  IF NEW.created_by IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only trigger for sales moderators (girls)
  IF NOT public.has_role(NEW.created_by, 'sales_moderator'::app_role) THEN
    RETURN NEW;
  END IF;

  SELECT phone, phone2, name,
         public.normalize_phone_eg(phone),
         public.normalize_phone_eg(phone2)
    INTO v_phone_raw, v_phone2_raw, v_name, v_phone, v_phone2
  FROM public.customers
  WHERE id = NEW.customer_id;

  -- No usable number on either phone column.
  IF COALESCE(v_phone, '') = '' AND COALESCE(v_phone2, '') = '' THEN
    RETURN NEW;
  END IF;

  -- Calendar month of the new order (Cairo), same bounds as before,
  -- plus a rolling 7 days anchored to this order's created_at.
  v_month_start := date_trunc('month', (NEW.created_at AT TIME ZONE 'Africa/Cairo')) AT TIME ZONE 'Africa/Cairo';
  v_month_end   := (v_month_start + INTERVAL '1 month');

  SELECT COUNT(*) INTO v_prev_count
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.id <> NEW.id
    AND (
      o.created_at >= NEW.created_at - interval '7 days'
      OR (
        o.created_at >= v_month_start
        AND o.created_at <  v_month_end
      )
    )
    AND (
      (NULLIF(v_phone, '') IS NOT NULL AND public.normalize_phone_eg(c.phone) = v_phone)
      OR (NULLIF(v_phone2, '') IS NOT NULL AND public.normalize_phone_eg(c.phone) = v_phone2)
      OR (NULLIF(v_phone, '') IS NOT NULL AND public.normalize_phone_eg(c.phone2) = v_phone)
      OR (NULLIF(v_phone2, '') IS NOT NULL AND public.normalize_phone_eg(c.phone2) = v_phone2)
    );

  IF v_prev_count > 0 THEN
    INSERT INTO public.notifications (title, description, type, order_id)
    VALUES (
      '⚠️ طلب مكرر لنفس العميل خلال الشهر',
      'تم تسجيل طلب جديد رقم ' || NEW.order_number ||
      ' للعميل ' || COALESCE(v_name, '') ||
      ' (هاتف: ' || COALESCE(NULLIF(btrim(v_phone_raw), ''), NULLIF(btrim(v_phone2_raw), ''), '') || ')' ||
      ' وله ' || v_prev_count::text || ' طلب/طلبات سابقة خلال نفس الشهر أو آخر 7 أيام.',
      'duplicate_customer_month',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$function$
;

-- find_own_repeat_order_candidates
CREATE OR REPLACE FUNCTION public.find_own_repeat_order_candidates(p_customer_id uuid, p_customer_name text, p_customer_phone text, p_delivery_address text DEFAULT NULL::text, p_shipping_company text DEFAULT NULL::text, p_fulfillment_type text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb)
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
      AND o.created_by = v_uid
      AND (
        o.created_at >= now() - interval '7 days'
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

-- Restate production ACLs (no-op when they are already set).
REVOKE ALL ON FUNCTION public.find_duplicate_order_candidates(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_duplicate_order_candidates(uuid, text, text, text, text, text, jsonb) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.customer_has_other_order_this_month(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_has_other_order_this_month(uuid, uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.notify_duplicate_customer_order_monthly() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_duplicate_customer_order_monthly() TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.find_own_repeat_order_candidates(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_own_repeat_order_candidates(uuid, text, text, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_own_repeat_order_candidates(uuid, text, text, text, text, text, jsonb) TO authenticated, service_role;
