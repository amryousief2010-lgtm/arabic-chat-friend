-- Least privilege for marketing-only managers (role marketing_sales_manager ONLY, e.g. محمد سيد).
-- Users holding msm + another role (e.g. آلاء: msm + sales_manager) are NOT affected:
-- all restrictions are RESTRICTIVE policies keyed on is_marketing_only_user().
-- Approved by GM (عمرو يوسف) 2026-11-03.

-- 0) helper -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_marketing_only_user(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'marketing_sales_manager')
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role <> 'marketing_sales_manager')
$$;
REVOKE ALL ON FUNCTION public.is_marketing_only_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_marketing_only_user(uuid) TO authenticated, service_role;

-- 1) remove write/delete rights ---------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('orders','DELETE'),('orders','INSERT'),
    ('order_items','DELETE'),
    ('customers','DELETE'),
    ('products','INSERT'),('products','UPDATE'),('products','DELETE'),
    ('payroll_bonus_overrides','INSERT'),('payroll_bonus_overrides','UPDATE'),('payroll_bonus_overrides','DELETE'),
    ('payroll_carried_orders','INSERT'),('payroll_carried_orders','UPDATE'),('payroll_carried_orders','DELETE'),
    ('payroll_month_closures','INSERT'),('payroll_month_closures','UPDATE'),('payroll_month_closures','DELETE'),
    ('payroll_month_snapshots','INSERT'),('payroll_month_snapshots','UPDATE'),('payroll_month_snapshots','DELETE'),
    ('target_bonus_settings','INSERT'),('target_bonus_settings','UPDATE'),('target_bonus_settings','DELETE'),
    ('processed_kg_bonus_schedules','INSERT'),('processed_kg_bonus_schedules','UPDATE'),('processed_kg_bonus_schedules','DELETE')
  ) v(tbl, cmd) LOOP
    IF to_regclass('public.'||t.tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'mkt_only_no_'||lower(t.cmd), t.tbl);
    IF t.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (SELECT public.is_marketing_only_user(auth.uid())))', 'mkt_only_no_insert', t.tbl);
    ELSIF t.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT (SELECT public.is_marketing_only_user(auth.uid())))', 'mkt_only_no_update', t.tbl);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT (SELECT public.is_marketing_only_user(auth.uid())))', 'mkt_only_no_delete', t.tbl);
    END IF;
  END LOOP;
END $$;

-- 2) customers: no direct row access (phone/phone2/address); masked view instead -------
DROP POLICY IF EXISTS mkt_only_no_select ON public.customers;
CREATE POLICY mkt_only_no_select ON public.customers AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_marketing_only_user(auth.uid())));

CREATE OR REPLACE VIEW public.customers_masked AS
  SELECT c.id, c.name, c.email, c.city, c.governorate, c.area, c.source, c.communication_channel,
         c.campaign_name, c.total_orders, c.total_spent, c.created_at
  FROM public.customers c
  WHERE public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager',
        'marketing_sales_manager','marketing_sales_viewer','accountant','financial_manager',
        'warehouse_supervisor']::public.app_role[]);
COMMENT ON VIEW public.customers_masked IS 'Customers without phone/phone2/address/notes for marketing-only managers.';
REVOKE ALL ON public.customers_masked FROM PUBLIC, anon;
GRANT SELECT ON public.customers_masked TO authenticated, service_role;

-- 3) notifications: marketing-only user sees only notifications targeted to them --------
DROP POLICY IF EXISTS mkt_only_own_notifications ON public.notifications;
CREATE POLICY mkt_only_own_notifications ON public.notifications AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_marketing_only_user(auth.uid())) OR target_user_id = (SELECT auth.uid()));

-- 4) narrow viewer gate for «مؤشرات الأداء» + «الإنفاق الإعلاني اليومي» only -----------
CREATE TABLE IF NOT EXISTS public.cm_kpi_viewer_allowlist (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cm_kpi_viewer_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cm_kpi_viewer_allowlist FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS gm_manage ON public.cm_kpi_viewer_allowlist;
CREATE POLICY gm_manage ON public.cm_kpi_viewer_allowlist FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'general_manager')) WITH CHECK (public.has_role(auth.uid(),'general_manager'));
GRANT SELECT, INSERT, DELETE ON public.cm_kpi_viewer_allowlist TO authenticated;
INSERT INTO public.cm_kpi_viewer_allowlist(user_id, note)
  VALUES ('449e61e4-a7d0-411d-bcae-0841b3d5d982','محمد سيد — مؤشرات الأداء + الإنفاق الإعلاني (قراءة فقط)')
  ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.cm_kpi_viewer_allows()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.cm_kpi_viewer_allowlist WHERE user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.cm_kpiv_assert() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.cm_gate_allows() OR public.cm_kpi_viewer_allows()) THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
END $$;


-- The cm_* KPI views filter on cm_gate_allows(). Inside the cm_kpiv_* wrappers only (transaction-local flag,
-- set after cm_kpiv_assert passed), an allowlisted KPI viewer is treated as allowed. Outside the wrappers nothing changes.
CREATE OR REPLACE FUNCTION public.cm_gate_allows()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT (auth.uid() IS NULL
          AND coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role')
              NOT IN ('anon','authenticated'))
      OR coalesce((SELECT access_mode FROM public.cm_feature_gate WHERE id), 'general_manager_only') = 'roles'
      OR public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[])
      OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.cm_feature_gate_allowlist a WHERE a.user_id = auth.uid()))
      OR (current_setting('cm.kpiv_ctx', true) = '1' AND public.cm_kpi_viewer_allows())
$function$;

CREATE OR REPLACE FUNCTION public.cm_kpiv_enter() RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.cm_kpiv_assert();
  PERFORM set_config('cm.kpiv_ctx', '1', true);
END $$;

CREATE OR REPLACE FUNCTION public.cm_kpiv_by_moderator(_from date, _to date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; BEGIN PERFORM public.cm_kpiv_enter();
  r := (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cm_kpi_by_moderator(_from, _to) t); PERFORM set_config('cm.kpiv_ctx','',true); RETURN r; END $$;
CREATE OR REPLACE FUNCTION public.cm_kpiv_by_campaign(_from date, _to date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; BEGIN PERFORM public.cm_kpiv_enter();
  r := (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cm_kpi_by_campaign(_from, _to) t); PERFORM set_config('cm.kpiv_ctx','',true); RETURN r; END $$;

-- funnel + ad-spend data (ids/labels/aggregates only; no phones, no message bodies)
CREATE OR REPLACE FUNCTION public.cm_kpiv_funnel_data(_from date, _to date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; BEGIN PERFORM public.cm_kpiv_enter();
  r := jsonb_build_object(
    'spend', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'campaign_id',s.campaign_id,'spend_date',s.spend_date,'spend',s.spend,
                 'impressions',s.impressions,'clicks',s.clicks,'currency',s.currency,'source',s.source) ORDER BY s.spend_date), '[]')
              FROM public.cm_ad_spend_daily s WHERE s.spend_date BETWEEN _from AND _to),
    'recent', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.spend_date DESC), '[]') FROM (
                 SELECT s.id, s.campaign_id, s.spend_date, s.spend, s.currency, s.impressions, s.clicks, s.source
                 FROM public.cm_ad_spend_daily s ORDER BY s.spend_date DESC LIMIT 200) x),
    'campaigns', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'meta_campaign_id',c.meta_campaign_id,'product_tag',c.product_tag) ORDER BY c.name), '[]') FROM public.cm_campaigns c),
    'maps', (SELECT coalesce(jsonb_agg(jsonb_build_object('campaign_id',m.campaign_id,'line_id',m.line_id,'valid_from',m.valid_from,'valid_to',m.valid_to)), '[]') FROM public.cm_campaign_line_map m),
    'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'label',l.label,'owner_moderator_id',l.owner_moderator_id)), '[]') FROM public.cm_lines l),
    'moderators', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'display_name',o.display_name)), '[]') FROM public.cm_moderators o),
    'ads', (SELECT coalesce(jsonb_agg(jsonb_build_object('campaign_id',a.campaign_id,'meta_ad_id',a.meta_ad_id,'name',a.name)), '[]') FROM public.cm_campaign_ads a),
    'convs', (SELECT coalesce(jsonb_agg(jsonb_build_object('conversation_id',v.conversation_id,'line_id',v.line_id,'moderator_id',v.moderator_id,
                 'campaign_id',v.campaign_id,'first_reply_status',v.first_reply_status,'is_abandoned',v.is_abandoned)), '[]')
              FROM public.cm_kpi_conversations_v v
              WHERE v.first_inbound_at >= (_from - 1) AND v.first_inbound_at < (_to + 2) AND v.kpi_date BETWEEN _from AND _to),
    'orders', (SELECT coalesce(jsonb_agg(jsonb_build_object('order_id',o.order_id,'conversation_id',o.conversation_id,
                 'is_delivered',o.is_delivered,'delivered_value',o.delivered_value)), '[]')
              FROM public.cm_kpi_orders_v o WHERE o.created_at >= (_from - 1) AND o.conversation_id IS NOT NULL)
  ); PERFORM set_config('cm.kpiv_ctx','',true); RETURN r; END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['cm_kpi_viewer_allows()','cm_kpiv_assert()','cm_kpiv_enter()','cm_kpiv_by_moderator(date,date)','cm_kpiv_by_campaign(date,date)',
    'cm_kpiv_funnel_data(date,date)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP; END $$;

-- 5) display name -------------------------------------------------------------------
UPDATE public.profiles SET full_name = 'محمد سيد' WHERE id = '449e61e4-a7d0-411d-bcae-0841b3d5d982';

NOTIFY pgrst, 'reload schema';
