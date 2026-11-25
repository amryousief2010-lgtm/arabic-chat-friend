-- =====================================================================
-- صلاحية العروض + نسخة احتياطية قبل كل كتابة على الموقع
-- طلب م. عمرو (25/11/2026):
--   أ) العرض «مفتوح بدون مدة» (الافتراضي؛ العروض الحالية تبقى مفتوحة) أو «له مدة»
--      بتاريخ بداية ونهاية قابلَين للتعديل في أي وقت. خارج النافذة لا يُختار
--      لطلبات جديدة (الطلبات القائمة لا تُمس)، ويُخفى على الموقع
--      بـ catalog_visibility=hidden مع بقاء الحالة publish (عكسها آمن).
--      عند تمديد/إعادة فتح المدة يعود الظهور. الإخفاء التلقائي: pg_cron
--      كل 5 دقائق يستدعي woo-catalog-sync (إجراء expire_offers) بسرّ
--      WOO_CATALOG_CRON_SECRET — آمن، مسجَّل، وعديم الأثر عند التكرار.
--      لا تغيير لسعر العرض أو الشحن أو المكوّنات. لا نوقف is_active تلقائيًا.
--   ب) قبل كل كتابة على الموقع تُحفظ لقطة JSON كاملة للمنتج، مع من أكّد ومتى،
--      واسترجاع من شاشة منتجات الموقع بمعاينة الفروق وفحص تعارض 409.
-- يعتمد على 20261126030000_website_products_manage.sql.
-- =====================================================================

-- 1) علامات إخفاء الموقع بسبب الصلاحية (لا نعيد الإظهار إلا لما أخفيناه نحن)
ALTER TABLE public.offer_boxes
  ADD COLUMN IF NOT EXISTS site_hidden_by_validity boolean NOT NULL DEFAULT false;
ALTER TABLE public.offer_boxes
  ADD COLUMN IF NOT EXISTS validity_prev_catalog_visibility text;

COMMENT ON COLUMN public.offer_boxes.starts_at IS 'بداية صلاحية العرض؛ مع expires_at الفارغين = مفتوح بدون مدة.';
COMMENT ON COLUMN public.offer_boxes.expires_at IS 'نهاية صلاحية العرض؛ فارغ مع starts_at = مفتوح بدون مدة.';
COMMENT ON COLUMN public.offer_boxes.site_hidden_by_validity IS 'أخفينا منتج الموقع بسبب انتهاء/عدم بدء المدة حتى نعيد إظهاره عند التمديد فقط.';
COMMENT ON COLUMN public.offer_boxes.validity_prev_catalog_visibility IS 'ظهور المتجر قبل الإخفاء التلقائي (عادة visible).';

-- 2) لا نوقف العروض المنتهية تلقائيًا (is_active يبقى يدويًا). الدالة تُستدعى من شاشة العروض قديمًا.
CREATE OR REPLACE FUNCTION public.deactivate_expired_offers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- كانت تقلب is_active=false؛ الصلاحية صارت بالتواريخ + إخفاء الموقع، بدون المساس بهوية العرض.
  RETURN;
END;
$$;

-- 3) اختيار العرض لطلب جديد
CREATE OR REPLACE FUNCTION public.offer_box_is_selectable(_id uuid, _at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT b.is_active
       AND (b.starts_at IS NULL OR b.starts_at <= _at)
       AND (b.expires_at IS NULL OR b.expires_at > _at)
    FROM public.offer_boxes b
    WHERE b.id = _id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.offer_box_is_selectable(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offer_box_is_selectable(uuid, timestamptz) TO authenticated, service_role;

-- 4) ضبط المدة من شاشة منتجات الموقع (آلاء / المدير العام / التنفيذي)
CREATE OR REPLACE FUNCTION public.website_set_offer_validity(
  _box_id uuid, _mode text, _starts_at timestamptz, _expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before jsonb;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF v_uid IS NULL OR NOT public.website_inbox_can_manage() THEN
    RAISE EXCEPTION 'WOO_FORBIDDEN';
  END IF;
  IF _mode NOT IN ('open', 'window') THEN RAISE EXCEPTION 'WOO_BAD_INPUT'; END IF;
  IF _mode = 'open' THEN
    v_start := NULL;
    v_end := NULL;
  ELSE
    IF _starts_at IS NULL OR _expires_at IS NULL THEN RAISE EXCEPTION 'WOO_DATES_REQUIRED'; END IF;
    IF _starts_at >= _expires_at THEN RAISE EXCEPTION 'WOO_END_BEFORE_START'; END IF;
    v_start := _starts_at;
    v_end := _expires_at;
  END IF;

  SELECT jsonb_build_object(
    'starts_at', starts_at, 'expires_at', expires_at,
    'offer_price', offer_price, 'shipping_cost', shipping_cost,
    'site_hidden_by_validity', site_hidden_by_validity
  ) INTO v_before
  FROM public.offer_boxes WHERE id = _box_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'WOO_NOT_FOUND'; END IF;

  UPDATE public.offer_boxes
     SET starts_at = v_start,
         expires_at = v_end,
         updated_at = now()
   WHERE id = _box_id;
  -- لا نلمس offer_price ولا shipping_cost ولا المكوّنات ولا is_active.

  INSERT INTO public.woo_sync_log (actor, action, offer_box_id, before, after)
  VALUES (
    v_uid, 'coc_validity', _box_id, v_before,
    jsonb_build_object('starts_at', v_start, 'expires_at', v_end, 'mode', _mode)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'starts_at', v_start,
    'expires_at', v_end,
    'in_window', (v_start IS NULL OR v_start <= now()) AND (v_end IS NULL OR v_end > now()),
    'site_hidden_by_validity', (v_before->>'site_hidden_by_validity')::boolean
  );
END;
$$;

REVOKE ALL ON FUNCTION public.website_set_offer_validity(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_set_offer_validity(uuid, text, timestamptz, timestamptz) TO authenticated;

-- 5) مهام الإخفاء/الإظهار التلقائي (idempotent)
CREATE OR REPLACE FUNCTION public.website_offer_validity_jobs()
RETURNS TABLE (
  offer_box_id uuid,
  woo_product_id bigint,
  starts_at timestamptz,
  expires_at timestamptz,
  site_hidden_by_validity boolean,
  validity_prev_catalog_visibility text,
  wanted text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT b.id,
         m.woo_product_id,
         b.starts_at,
         b.expires_at,
         b.site_hidden_by_validity,
         b.validity_prev_catalog_visibility,
         CASE
           WHEN (b.starts_at IS NOT NULL OR b.expires_at IS NOT NULL)
            AND NOT ((b.starts_at IS NULL OR b.starts_at <= now()) AND (b.expires_at IS NULL OR b.expires_at > now()))
             THEN 'hide'
           WHEN b.site_hidden_by_validity
            AND (b.starts_at IS NULL OR b.starts_at <= now())
            AND (b.expires_at IS NULL OR b.expires_at > now())
             THEN 'show'
           ELSE 'none'
         END
  FROM public.offer_boxes b
  JOIN public.woo_product_map m ON m.offer_box_id = b.id AND m.woo_variation_id = 0
  WHERE (
    ((b.starts_at IS NOT NULL OR b.expires_at IS NOT NULL)
      AND NOT ((b.starts_at IS NULL OR b.starts_at <= now()) AND (b.expires_at IS NULL OR b.expires_at > now())))
    OR b.site_hidden_by_validity
  );
$$;

REVOKE ALL ON FUNCTION public.website_offer_validity_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_offer_validity_jobs() TO service_role;

CREATE OR REPLACE FUNCTION public.website_set_validity_site_flag(
  _box_id uuid, _hidden boolean, _prev_visibility text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.offer_boxes
     SET site_hidden_by_validity = _hidden,
         validity_prev_catalog_visibility = CASE WHEN _hidden THEN _prev_visibility ELSE NULL END,
         updated_at = now()
   WHERE id = _box_id;
END;
$$;

REVOKE ALL ON FUNCTION public.website_set_validity_site_flag(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_set_validity_site_flag(uuid, boolean, text) TO service_role;

-- 6) سجل الكتابة: أنواع جديدة + لقطة المنتج قبل الكتابة
ALTER TABLE public.woo_sync_log DROP CONSTRAINT IF EXISTS woo_sync_log_action_check;
ALTER TABLE public.woo_sync_log ADD CONSTRAINT woo_sync_log_action_check CHECK (action IN (
  'refresh','map','unmap','import_to_coc','pull_price','push_create','push_update',
  'coc_price','coc_box_price','coc_image','coc_validity',
  'site_price','site_sale','site_visibility','site_sku','site_image',
  'site_validity','site_restore'));

CREATE TABLE IF NOT EXISTS public.woo_product_backups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id         uuid REFERENCES public.woo_sync_log(id) ON DELETE SET NULL,
  woo_product_id bigint NOT NULL,
  snapshot       jsonb NOT NULL,
  snapshot_sha   text NOT NULL,
  confirmed_by   uuid REFERENCES auth.users(id),
  confirmed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS woo_product_backups_log_idx ON public.woo_product_backups (log_id);
CREATE INDEX IF NOT EXISTS woo_product_backups_woo_idx ON public.woo_product_backups (woo_product_id, confirmed_at DESC);

ALTER TABLE public.woo_product_backups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS woo_product_backups_select ON public.woo_product_backups;
CREATE POLICY woo_product_backups_select ON public.woo_product_backups
  FOR SELECT TO authenticated USING (public.website_inbox_can_manage());
REVOKE ALL ON public.woo_product_backups FROM anon;
GRANT SELECT ON public.woo_product_backups TO authenticated;
GRANT ALL ON public.woo_product_backups TO service_role;

CREATE OR REPLACE FUNCTION public.woo_product_backup_write(
  _log_id uuid, _woo_product_id bigint, _snapshot jsonb, _snapshot_sha text, _confirmed_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF _snapshot IS NULL OR _woo_product_id IS NULL THEN RAISE EXCEPTION 'WOO_BAD_INPUT'; END IF;
  INSERT INTO public.woo_product_backups (log_id, woo_product_id, snapshot, snapshot_sha, confirmed_by)
  VALUES (_log_id, _woo_product_id, _snapshot, left(_snapshot_sha, 128), _confirmed_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.woo_product_backup_write(uuid, bigint, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.woo_product_backup_write(uuid, bigint, jsonb, text, uuid) TO service_role;

-- 7) استدعاء دوري لـ woo-catalog-sync / expire_offers (بدون مفاتيح وهمية: إن نقص السر يُتخطى)
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.woo_catalog_invoke_expire_offers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE s text; u text; k text; rid bigint; h jsonb;
BEGIN
  SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name = 'woo_catalog_cron_secret' LIMIT 1;
  IF s IS NULL OR btrim(s) = '' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing_woo_catalog_cron_secret');
  END IF;
  SELECT decrypted_secret INTO u FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  IF u IS NULL OR btrim(u) = '' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing_project_url');
  END IF;
  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets WHERE name = 'project_anon_key' LIMIT 1;
  h := jsonb_build_object('Content-Type', 'application/json', 'x-woo-catalog-cron-secret', s);
  IF k IS NOT NULL AND btrim(k) <> '' THEN h := h || jsonb_build_object('apikey', k); END IF;
  rid := net.http_post(
    url := rtrim(btrim(u), '/') || '/functions/v1/woo-catalog-sync',
    headers := h,
    body := jsonb_build_object('action', 'expire_offers', 'source', 'cron'),
    timeout_milliseconds := 120000
  );
  RETURN jsonb_build_object('ok', true, 'request_id', rid);
END;
$$;

REVOKE ALL ON FUNCTION private.woo_catalog_invoke_expire_offers() FROM PUBLIC;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION private.woo_catalog_invoke_expire_offers() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION private.woo_catalog_invoke_expire_offers() FROM authenticated;
  END IF;
END $g$;

DO $c$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'woo-offer-validity-expire') THEN
    PERFORM cron.unschedule('woo-offer-validity-expire');
  END IF;
END $c$;

SELECT cron.schedule(
  'woo-offer-validity-expire',
  '*/5 * * * *',
  $$SET statement_timeout = '120s'; SET lock_timeout = '2s'; SELECT private.woo_catalog_invoke_expire_offers();$$
);
