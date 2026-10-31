-- «تم الطلب» مُتحقَّق برقم العميل + إظهار رقم المحادثة بسجل تدقيق — طلب م. عمرو 31-10-2026، بروفة أولاً.
-- التعريف الجديد (محادثة): طلب غير ملغي لعميل رقمه (customers.phone / phone2 / cm_contact_phones الصالحة، بعد التطبيع)
--   = phone_norm المحادثة، وأُنشئ من (first_inbound_at − يوم) إلى (first_inbound_at + conversion_window_days) — نفس نافذة
--   cm_suggest_conversation_orders. وتُحسب أيضاً الروابط الصريحة في cm_conversation_orders (يدوي) داخل النافذة الأصلية.
--   حساب ديناميكي (لا روابط تلقائية) ⇒ idempotent ويتبع أي طلب جديد فوراً.
-- (مكالمة): نفس المطابقة، طلب غير ملغي أُنشئ من started_at إلى started_at + conversion_window_days.
-- المؤشرات: cm_kpi_conversations_v.converted_in_window و cm_kpi_orders_v (الحملة/المحادثة) يستخدمان نفس التعريف ⇒ الشارة = «تحوّلت».
-- الأدلة: رقم الطلب، تاريخه، اسم العميل على الطلب، من سجّله (orders.moderator_id ← orders.moderator نصاً ← created_by)
--   وهل هو نفس مودريتور المحادثة/المكالمة.
-- الرقم: cm_reveal_conversation_phone(_conversation_id) لمن يملك cm_can_manage() أو cm_can_listen_recordings()، وكل إظهار
--   يُسجَّل في cm_phone_reveal_log (عمود conversation_id جديد؛ call_id صار nullable).
-- لا تغيير على RLS الطلبات/العملاء (الـ views/الدوال security invoker).
-- التراجع: DROP FUNCTION cm_call_order_flags(uuid[]), cm_reveal_conversation_phone(uuid), cm_order_evidence_json(uuid,uuid,text);
--   DROP FUNCTION cm_conversation_order_flags(); ثم أعد إنشاءها من 20261030190000؛ أعد cm_kpi_conversations_v و cm_kpi_orders_v
--   من 20261025150000؛ DROP VIEW cm_conversation_order_matches_v, cm_call_order_matches_v; DROP FUNCTION cm_customer_ids_for_phone(text);
--   DELETE FROM cm_phone_reveal_log WHERE call_id IS NULL; ALTER TABLE cm_phone_reveal_log DROP COLUMN conversation_id, ALTER call_id SET NOT NULL.

-- عملاء رقم معيّن (فهارس normalize_phone_eg الموجودة على customers تُستخدم)
CREATE OR REPLACE FUNCTION public.cm_customer_ids_for_phone(_phone_norm text)
RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM public.customers WHERE _phone_norm IS NOT NULL AND normalize_phone_eg(phone) = _phone_norm
  UNION SELECT id FROM public.customers WHERE _phone_norm IS NOT NULL AND phone2 IS NOT NULL AND btrim(phone2) <> '' AND normalize_phone_eg(phone2) = _phone_norm
  UNION SELECT customer_id FROM public.cm_contact_phones WHERE _phone_norm IS NOT NULL AND phone_norm = _phone_norm AND is_valid AND customer_id IS NOT NULL
$$;

-- من سجّل الطلب (مودريتور)
CREATE OR REPLACE FUNCTION public.cm_order_registrar_id(_moderator_id uuid, _moderator text, _created_by uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(_moderator_id, public.cm_moderator_id_for_name(_moderator),
                  (SELECT id FROM public.cm_moderators WHERE user_id = _created_by LIMIT 1))
$$;

CREATE OR REPLACE VIEW public.cm_conversation_order_matches_v WITH (security_invoker = true) AS
WITH k AS (SELECT coalesce((SELECT conversion_window_days FROM public.cm_kpi_settings WHERE id = 1), 7) AS win)
SELECT c.id AS conversation_id, o.id AS order_id, 'phone_match'::text AS method
FROM public.cm_conversations c CROSS JOIN k
JOIN LATERAL public.cm_customer_ids_for_phone(c.phone_norm) cu(id) ON true
JOIN public.orders o ON o.customer_id = cu.id AND o.created_at >= c.first_inbound_at - interval '1 day'
  AND o.created_at < c.first_inbound_at + make_interval(days => k.win) AND NOT public.cm_order_is_cancelled(o.status)
WHERE c.first_inbound_at IS NOT NULL AND c.phone_norm IS NOT NULL
UNION
SELECT l.conversation_id, l.order_id, l.method
FROM public.cm_conversation_orders l JOIN public.cm_conversations c ON c.id = l.conversation_id
JOIN public.orders o ON o.id = l.order_id CROSS JOIN k
WHERE NOT public.cm_order_is_cancelled(o.status)
  AND o.created_at >= c.first_inbound_at AND o.created_at < c.first_inbound_at + make_interval(days => k.win);

CREATE OR REPLACE VIEW public.cm_call_order_matches_v WITH (security_invoker = true) AS
WITH k AS (SELECT coalesce((SELECT conversion_window_days FROM public.cm_kpi_settings WHERE id = 1), 7) AS win)
SELECT x.id AS call_id, o.id AS order_id, 'phone_match'::text AS method
FROM public.cm_calls x CROSS JOIN k
JOIN LATERAL public.cm_customer_ids_for_phone(x.phone_norm) cu(id) ON true
JOIN public.orders o ON o.customer_id = cu.id AND o.created_at >= x.started_at
  AND o.created_at < x.started_at + make_interval(days => k.win) AND NOT public.cm_order_is_cancelled(o.status)
WHERE x.phone_norm IS NOT NULL;

-- المؤشرات: نفس التعريف
CREATE OR REPLACE VIEW public.cm_kpi_conversations_v WITH (security_invoker = true) AS
SELECT conversation_id, line_id, moderator_id, campaign_id, first_inbound_at, kpi_date, first_reply_status, is_abandoned, converted_in_window
FROM (WITH k AS (SELECT coalesce((SELECT abandoned_minutes FROM public.cm_kpi_settings WHERE id = 1), 30) AS ab)
  SELECT c.id AS conversation_id, c.line_id, coalesce(c.assigned_moderator_id, c.owner_moderator_id) AS moderator_id,
    a.campaign_id, c.first_inbound_at, public.cm_local_date(c.first_inbound_at) AS kpi_date,
    public.cm_first_reply_kpi_status(c.clock_started_at, c.first_reply_at, c.first_reply_was_cover, coalesce(c.assigned_moderator_id, c.owner_moderator_id)) AS first_reply_status,
    (c.status IN ('open','pending') AND c.last_inbound_at IS NOT NULL AND (c.last_outbound_at IS NULL OR c.last_outbound_at < c.last_inbound_at)
      AND public.cm_service_minutes(c.last_inbound_at, now()) >= k.ab) AS is_abandoned,
    EXISTS (SELECT 1 FROM public.cm_conversation_order_matches_v m WHERE m.conversation_id = c.id) AS converted_in_window
  FROM public.cm_conversations c CROSS JOIN k LEFT JOIN public.cm_ad_attributions a ON a.conversation_id = c.id
  WHERE c.first_inbound_at IS NOT NULL) q
WHERE public.cm_gate_allows();

-- الطلبات: المحادثة = رابط صريح أولاً، وإلا أول محادثة يطابق رقمها رقم العميل داخل النافذة
CREATE OR REPLACE VIEW public.cm_kpi_orders_v WITH (security_invoker = true) AS
SELECT order_id, created_at, kpi_date, status, moderator_id, campaign_id, conversation_id, is_delivered, is_cancelled, is_resolved, delivered_value
FROM (WITH k AS (SELECT coalesce((SELECT conversion_window_days FROM public.cm_kpi_settings WHERE id = 1), 7) AS win)
  SELECT o.id AS order_id, o.created_at, public.cm_local_date(o.created_at) AS kpi_date, o.status,
    coalesce(o.moderator_id, lc.moderator_id) AS moderator_id, lc.campaign_id, lc.conversation_id,
    public.cm_order_is_delivered(o.status) AS is_delivered, public.cm_order_is_cancelled(o.status) AS is_cancelled,
    public.cm_order_is_resolved(o.status) AS is_resolved,
    CASE WHEN public.cm_order_is_delivered(o.status) THEN coalesce(o.total, 0) ELSE 0 END AS delivered_value
  FROM public.orders o CROSS JOIN k
  LEFT JOIN LATERAL (
    SELECT z.conversation_id, z.moderator_id, z.campaign_id FROM (
      SELECT 0 AS pri, l.conversation_id, coalesce(c.assigned_moderator_id, c.owner_moderator_id) AS moderator_id, a.campaign_id, c.first_inbound_at, l.created_at AS t
      FROM public.cm_conversation_orders l JOIN public.cm_conversations c ON c.id = l.conversation_id
      LEFT JOIN public.cm_ad_attributions a ON a.conversation_id = c.id WHERE l.order_id = o.id
      UNION ALL
      SELECT 1, c.id, coalesce(c.assigned_moderator_id, c.owner_moderator_id), a.campaign_id, c.first_inbound_at, c.first_inbound_at
      FROM public.cm_conversations c LEFT JOIN public.cm_ad_attributions a ON a.conversation_id = c.id
      WHERE o.customer_id IS NOT NULL AND c.first_inbound_at IS NOT NULL
        AND c.phone_norm IN (SELECT normalize_phone_eg(cu.phone) FROM public.customers cu WHERE cu.id = o.customer_id
                             UNION SELECT normalize_phone_eg(cu.phone2) FROM public.customers cu WHERE cu.id = o.customer_id AND cu.phone2 IS NOT NULL AND btrim(cu.phone2) <> ''
                             UNION SELECT cp.phone_norm FROM public.cm_contact_phones cp WHERE cp.customer_id = o.customer_id AND cp.is_valid)
        AND o.created_at >= c.first_inbound_at - interval '1 day' AND o.created_at < c.first_inbound_at + make_interval(days => k.win)
    ) z ORDER BY z.pri, z.first_inbound_at, z.t LIMIT 1) lc ON true) q
WHERE public.cm_gate_allows();

-- دليل طلب واحد (JSON) — security invoker ⇒ RLS الطلبات/العملاء تسري
CREATE OR REPLACE FUNCTION public.cm_order_evidence_json(_order_id uuid, _handler uuid, _method text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'created_at', o.created_at, 'status', o.status,
    'customer_name', cu.name, 'registered_by_id', r.rid, 'registered_by', coalesce(m.display_name, nullif(btrim(o.moderator), '')),
    'same_moderator', CASE WHEN r.rid IS NULL OR _handler IS NULL THEN NULL ELSE r.rid = _handler END, 'method', _method)
  FROM public.orders o LEFT JOIN public.customers cu ON cu.id = o.customer_id
  CROSS JOIN LATERAL (SELECT public.cm_order_registrar_id(o.moderator_id, o.moderator, o.created_by) AS rid) r
  LEFT JOIN public.cm_moderators m ON m.id = r.rid
  WHERE o.id = _order_id
$$;

DROP FUNCTION IF EXISTS public.cm_conversation_order_flags();
CREATE FUNCTION public.cm_conversation_order_flags()
RETURNS TABLE (conversation_id uuid, has_order boolean, orders bigint, evidence jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT m.conversation_id, true, count(DISTINCT m.order_id),
    jsonb_agg(public.cm_order_evidence_json(m.order_id, coalesce(c.assigned_moderator_id, c.owner_moderator_id), m.method) ORDER BY m.order_id)
  FROM (SELECT DISTINCT ON (conversation_id, order_id) * FROM public.cm_conversation_order_matches_v ORDER BY conversation_id, order_id, method) m JOIN public.cm_conversations c ON c.id = m.conversation_id
  WHERE public.cm_gate_allows() GROUP BY m.conversation_id
$$;

CREATE OR REPLACE FUNCTION public.cm_call_order_flags(_call_ids uuid[] DEFAULT NULL)
RETURNS TABLE (call_id uuid, has_order boolean, orders bigint, evidence jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT m.call_id, true, count(DISTINCT m.order_id),
    jsonb_agg(public.cm_order_evidence_json(m.order_id, x.moderator_id, m.method) ORDER BY m.order_id)
  FROM (SELECT DISTINCT ON (call_id, order_id) * FROM public.cm_call_order_matches_v ORDER BY call_id, order_id, method) m JOIN public.cm_calls x ON x.id = m.call_id
  WHERE public.cm_gate_allows() AND (_call_ids IS NULL OR m.call_id = ANY(_call_ids)) GROUP BY m.call_id
$$;

-- إظهار رقم المحادثة مع التدقيق
ALTER TABLE public.cm_phone_reveal_log ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.cm_conversations(id) ON DELETE CASCADE;
ALTER TABLE public.cm_phone_reveal_log ALTER COLUMN call_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS cm_phone_reveal_log_conv_idx ON public.cm_phone_reveal_log (conversation_id, revealed_at DESC) WHERE conversation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cm_reveal_conversation_phone(_conversation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.cm_gate_allows() OR NOT (public.cm_can_manage() OR public.cm_can_listen_recordings()) THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT phone_norm INTO v FROM public.cm_conversations WHERE id = _conversation_id;
  IF v IS NULL THEN RAISE EXCEPTION 'CM_NO_PHONE'; END IF;
  INSERT INTO public.cm_phone_reveal_log (conversation_id, user_id) VALUES (_conversation_id, auth.uid());
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.cm_customer_ids_for_phone(text), public.cm_order_registrar_id(uuid,text,uuid),
  public.cm_order_evidence_json(uuid,uuid,text), public.cm_conversation_order_flags(), public.cm_call_order_flags(uuid[]),
  public.cm_reveal_conversation_phone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_customer_ids_for_phone(text), public.cm_order_registrar_id(uuid,text,uuid),
  public.cm_order_evidence_json(uuid,uuid,text), public.cm_conversation_order_flags(), public.cm_call_order_flags(uuid[]),
  public.cm_reveal_conversation_phone(uuid) TO authenticated, service_role;
REVOKE ALL ON public.cm_conversation_order_matches_v, public.cm_call_order_matches_v FROM PUBLIC, anon;
GRANT SELECT ON public.cm_conversation_order_matches_v, public.cm_call_order_matches_v TO authenticated, service_role;
