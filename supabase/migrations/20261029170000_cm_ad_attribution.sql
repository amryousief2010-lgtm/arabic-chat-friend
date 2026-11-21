-- إسناد المحادثات للإعلانات (first-touch) — 29-10-2026، بروفة أولاً.
-- 1) أعمدة الإعلان على cm_conversations (ad_id / ad_headline / ad_source_type / ad_source_url / ad_attributed_at).
-- 2) cm_resolve_ad_campaign: يربط ad_id بحملة عبر cm_campaign_ads، وإن لم توجد يُنشئ حملة خفيفة (product_tag='AUTO_AD') + صف إعلان.
-- 3) cm_attribute_conversation: نفس التوقيع؛ لا يكتب فوق إسناد موجود له ad_id (first-touch) إلا يدوياً، ويحل الحملة.
-- 4) trigger على cm_messages: أول رسالة واردة فيها referral لمحادثة بلا إسناد ⇒ تُسند (حتى لو المحادثة قديمة).
-- 5) backfill من raw->referral للرسائل المخزنة + حل الحملة للإسنادات الموجودة بلا حملة.
-- التراجع: DROP TRIGGER trg_cm_messages_referral ON cm_messages; DROP FUNCTION cm_messages_referral_trg(), cm_resolve_ad_campaign(text,text);
--          أعد cm_attribute_conversation من 20261025130000؛ ALTER TABLE cm_conversations DROP COLUMN ad_id, ad_headline, ad_source_type, ad_source_url, ad_attributed_at;
--          DELETE FROM cm_campaigns WHERE product_tag='AUTO_AD' (يحذف cm_campaign_ads المرتبطة إن كان FK cascade، وإلا احذفها أولاً).

ALTER TABLE public.cm_conversations
  ADD COLUMN IF NOT EXISTS ad_id text,
  ADD COLUMN IF NOT EXISTS ad_headline text,
  ADD COLUMN IF NOT EXISTS ad_source_type text,
  ADD COLUMN IF NOT EXISTS ad_source_url text,
  ADD COLUMN IF NOT EXISTS ad_attributed_at timestamptz;
CREATE INDEX IF NOT EXISTS cm_conversations_ad_idx ON public.cm_conversations (ad_id) WHERE ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cm_conversations_campaign_idx ON public.cm_conversations (campaign_id) WHERE campaign_id IS NOT NULL;

-- حملة الإعلان: موجودة ⇒ هي؛ غير موجودة ⇒ حملة تلقائية باسم العنوان + آخر 6 أرقام من الإعلان.
CREATE OR REPLACE FUNCTION public.cm_resolve_ad_campaign(_ad_id text, _headline text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c uuid; v_name text;
BEGIN
  IF nullif(_ad_id, '') IS NULL THEN RETURN NULL; END IF;
  SELECT campaign_id INTO v_c FROM public.cm_campaign_ads WHERE meta_ad_id = _ad_id;
  IF v_c IS NOT NULL THEN RETURN v_c; END IF;
  v_name := coalesce(nullif(btrim(regexp_replace(_headline, '^\s*[\u064B-\u0652]+', '')), ''), 'إعلان') || ' · إعلان …' || right(_ad_id, 6);
  INSERT INTO public.cm_campaigns (name, objective, status, product_tag, is_default)
  VALUES (v_name, 'messages', 'active', 'AUTO_AD', false) RETURNING id INTO v_c;
  INSERT INTO public.cm_campaign_ads (campaign_id, meta_ad_id, name) VALUES (v_c, _ad_id, v_name)
  ON CONFLICT (meta_ad_id) DO NOTHING;
  IF NOT FOUND THEN  -- سباق: إعلان أُنشئ للتو من استدعاء آخر
    DELETE FROM public.cm_campaigns WHERE id = v_c;
    SELECT campaign_id INTO v_c FROM public.cm_campaign_ads WHERE meta_ad_id = _ad_id;
  END IF;
  RETURN v_c;
END $$;
REVOKE ALL ON FUNCTION public.cm_resolve_ad_campaign(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cm_resolve_ad_campaign(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cm_attribute_conversation(_conversation_id uuid, _ctwa_clid text DEFAULT NULL,
  _referral_source_id text DEFAULT NULL, _referral_source_type text DEFAULT NULL, _referral_headline text DEFAULT NULL,
  _manual_value text DEFAULT NULL, _manual_campaign_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_method text; v_campaign uuid; v_ex public.cm_ad_attributions;
BEGIN
  IF NOT (public.cm_is_system_or_manager() OR public.cm_can_manage_campaigns()) THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  v_method := CASE WHEN nullif(_ctwa_clid,'') IS NOT NULL THEN 'ctwa_clid'
                   WHEN nullif(_referral_source_id,'') IS NOT NULL THEN 'referral'
                   WHEN nullif(_manual_value,'') IS NOT NULL OR _manual_campaign_id IS NOT NULL THEN 'manual'
                   ELSE 'unknown' END;
  SELECT * INTO v_ex FROM public.cm_ad_attributions WHERE conversation_id = _conversation_id;
  -- first-touch: إسناد آلي لا يكتب فوق إعلان مسجَّل؛ اليدوي فقط يغيّره.
  IF v_ex.ad_id IS NOT NULL AND v_method <> 'manual' THEN
    IF v_ex.campaign_id IS NULL THEN
      v_campaign := public.cm_resolve_ad_campaign(v_ex.ad_id, v_ex.referral_headline);
      UPDATE public.cm_ad_attributions SET campaign_id = v_campaign WHERE id = v_ex.id;
      UPDATE public.cm_conversations SET campaign_id = v_campaign WHERE id = _conversation_id AND campaign_id IS NULL;
    END IF;
    RETURN v_ex.method;
  END IF;
  v_campaign := CASE WHEN v_method = 'manual' THEN _manual_campaign_id END;
  IF v_campaign IS NULL AND nullif(_referral_source_id,'') IS NOT NULL
     AND coalesce(_referral_source_type, 'ad') = 'ad' THEN
    v_campaign := public.cm_resolve_ad_campaign(_referral_source_id, _referral_headline);
  END IF;
  INSERT INTO public.cm_ad_attributions (conversation_id, method, ctwa_clid, referral_source_id, referral_source_type,
    referral_headline, manual_value, campaign_id, ad_id, set_by)
  VALUES (_conversation_id, v_method, _ctwa_clid, _referral_source_id, _referral_source_type, _referral_headline,
    _manual_value, v_campaign, _referral_source_id, auth.uid())
  ON CONFLICT (conversation_id) DO UPDATE SET method = EXCLUDED.method, ctwa_clid = EXCLUDED.ctwa_clid,
    referral_source_id = EXCLUDED.referral_source_id, referral_source_type = EXCLUDED.referral_source_type,
    referral_headline = EXCLUDED.referral_headline, manual_value = EXCLUDED.manual_value,
    campaign_id = EXCLUDED.campaign_id, ad_id = EXCLUDED.ad_id, set_by = EXCLUDED.set_by, captured_at = now();
  UPDATE public.cm_conversations SET campaign_id = coalesce(v_campaign, campaign_id),
    ad_id = coalesce(nullif(_referral_source_id,''), ad_id), ad_headline = coalesce(_referral_headline, ad_headline),
    ad_source_type = coalesce(_referral_source_type, ad_source_type), ad_attributed_at = coalesce(ad_attributed_at, now())
  WHERE id = _conversation_id;
  RETURN v_method;
END $$;

-- أول رسالة واردة بها referral لمحادثة لم تُسند لإعلان بعد.
CREATE OR REPLACE FUNCTION public.cm_messages_referral_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb := NEW.raw -> 'referral';
BEGIN
  IF NEW.direction = 'in' AND jsonb_typeof(r) = 'object' AND nullif(r->>'source_id','') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.cm_conversations c WHERE c.id = NEW.conversation_id AND c.ad_id IS NOT NULL) THEN
    PERFORM public.cm_attribute_conversation(NEW.conversation_id, r->>'ctwa_clid', r->>'source_id', r->>'source_type', r->>'headline');
    UPDATE public.cm_conversations SET ad_source_url = coalesce(ad_source_url, r->>'source_url'),
      ad_attributed_at = least(ad_attributed_at, NEW.sent_at) WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_cm_messages_referral ON public.cm_messages;
CREATE TRIGGER trg_cm_messages_referral AFTER INSERT ON public.cm_messages
  FOR EACH ROW WHEN (NEW.direction = 'in' AND NEW.raw ? 'referral') EXECUTE FUNCTION public.cm_messages_referral_trg();

-- backfill: الإسنادات الموجودة ⇒ أعمدة المحادثة + الحملة.
DO $$ DECLARE a record; r jsonb; BEGIN
  FOR a IN SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.raw -> 'referral' AS ref, m.sent_at
           FROM public.cm_messages m WHERE m.direction = 'in' AND m.raw ? 'referral' AND nullif(m.raw->'referral'->>'source_id','') IS NOT NULL
           ORDER BY m.conversation_id, m.sent_at LOOP
    r := a.ref;
    PERFORM public.cm_attribute_conversation(a.conversation_id, r->>'ctwa_clid', r->>'source_id', r->>'source_type', r->>'headline');
    UPDATE public.cm_conversations c SET
      ad_id = coalesce(c.ad_id, at.ad_id), ad_headline = coalesce(c.ad_headline, at.referral_headline),
      ad_source_type = coalesce(c.ad_source_type, at.referral_source_type), ad_source_url = coalesce(c.ad_source_url, r->>'source_url'),
      ad_attributed_at = coalesce(c.ad_attributed_at, a.sent_at), campaign_id = coalesce(c.campaign_id, at.campaign_id)
    FROM public.cm_ad_attributions at WHERE at.conversation_id = c.id AND c.id = a.conversation_id;
  END LOOP;
  -- إسنادات بلا رسالة referral مخزنة (مثل بيانات DEMO): انسخ للأعمدة فقط.
  UPDATE public.cm_conversations c SET ad_id = coalesce(c.ad_id, at.ad_id), ad_headline = coalesce(c.ad_headline, at.referral_headline),
    ad_source_type = coalesce(c.ad_source_type, at.referral_source_type), campaign_id = coalesce(c.campaign_id, at.campaign_id),
    ad_attributed_at = coalesce(c.ad_attributed_at, at.captured_at)
  FROM public.cm_ad_attributions at WHERE at.conversation_id = c.id AND at.ad_id IS NOT NULL AND c.ad_id IS NULL;
END $$;

-- خيارات فلتر الإعلان/الحملة للواجهة (حسب RLS المستخدم).
CREATE OR REPLACE FUNCTION public.cm_ad_filter_options()
RETURNS TABLE (campaign_id uuid, campaign_name text, ad_id text, conversations bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT c.campaign_id, cp.name, c.ad_id, count(*) FROM public.cm_conversations c
  LEFT JOIN public.cm_campaigns cp ON cp.id = c.campaign_id
  WHERE c.ad_id IS NOT NULL OR c.campaign_id IS NOT NULL GROUP BY 1, 2, 3 ORDER BY 4 DESC
$$;
GRANT EXECUTE ON FUNCTION public.cm_ad_filter_options() TO authenticated, service_role;
