-- قائمة «كل المحادثات»: اسم الإعلان + شارة «تم الطلب» + إعادة تسمية حملة الإعلان — 30-10-2026، بروفة أولاً.
-- 1) cm_conversation_order_flags(): لكل محادثة has_order/orders بنفس تعريف «converted» في المؤشرات
--    (cm_kpi_conversations_v.converted_in_window: طلب غير ملغي مربوط عبر cm_conversation_orders وأُنشئ خلال
--    conversion_window_days من first_inbound_at). SECURITY INVOKER ⇒ RLS المستخدم + بوابة cm_gate_allows().
-- 2) cm_rename_campaign(_campaign_id, _name): إعادة تسمية حملة (مثل «إعلان التجار») — البوابة + cm_can_manage_campaigns()،
--    ويُحدّث اسم صفوف cm_campaign_ads التابعة، ويُسجَّل في cm_audit_log.
-- لا تغيير على RLS الطلبات/العملاء. Idempotent (CREATE OR REPLACE).
-- التراجع: DROP FUNCTION IF EXISTS public.cm_conversation_order_flags(); DROP FUNCTION IF EXISTS public.cm_rename_campaign(uuid, text);
--          (الأسماء المعدّلة تبقى؛ الأسماء القديمة في cm_audit_log action='campaign_renamed'.)

CREATE OR REPLACE FUNCTION public.cm_conversation_order_flags()
RETURNS TABLE (conversation_id uuid, has_order boolean, orders bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH k AS (SELECT coalesce((SELECT conversion_window_days FROM public.cm_kpi_settings WHERE id = 1), 7) AS win)
  SELECT v.conversation_id, true,
         (SELECT count(DISTINCT o.id) FROM public.cm_conversation_orders l JOIN public.orders o ON o.id = l.order_id
           CROSS JOIN k
           WHERE l.conversation_id = v.conversation_id AND NOT public.cm_order_is_cancelled(o.status)
             AND o.created_at >= v.first_inbound_at AND o.created_at < v.first_inbound_at + make_interval(days => k.win))
  FROM public.cm_kpi_conversations_v v
  WHERE v.converted_in_window AND public.cm_gate_allows()
$$;
REVOKE ALL ON FUNCTION public.cm_conversation_order_flags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_conversation_order_flags() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cm_rename_campaign(_campaign_id uuid, _name text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old text; v_new text := btrim(coalesce(_name, ''));
BEGIN
  PERFORM public.cm_gate_assert();
  IF NOT public.cm_can_manage_campaigns() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF v_new = '' OR length(v_new) > 120 THEN RAISE EXCEPTION 'CM_BAD_NAME' USING ERRCODE = '22023'; END IF;
  SELECT name INTO v_old FROM public.cm_campaigns WHERE id = _campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_old IS DISTINCT FROM v_new THEN
    UPDATE public.cm_campaigns SET name = v_new WHERE id = _campaign_id;
    UPDATE public.cm_campaign_ads SET name = v_new WHERE campaign_id = _campaign_id AND name IS NOT DISTINCT FROM v_old;
    INSERT INTO public.cm_audit_log (actor_id, action, entity, entity_id, before, after)
    VALUES (auth.uid(), 'campaign_renamed', 'cm_campaigns', _campaign_id::text,
            jsonb_build_object('name', v_old), jsonb_build_object('name', v_new));
  END IF;
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.cm_rename_campaign(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_rename_campaign(uuid, text) TO authenticated, service_role;
