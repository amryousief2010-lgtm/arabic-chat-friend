-- Speed up chat KPIs by campaign (GM approval 7/11, same pattern as by_moderator).
ALTER FUNCTION public.cm_kpi_by_campaign(date, date) RENAME TO cm_kpi_by_campaign_core;

CREATE FUNCTION public.cm_kpi_by_campaign_fast(_from date, _to date)
RETURNS TABLE(campaign_id uuid, campaign_name text, spend numeric, conversations bigint, converted bigint, orders bigint, delivered bigint, resolved bigint, delivered_value numeric, cost_per_delivered numeric) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.cm_can_read_all() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.cm_kpi_by_campaign_core(_from, _to);
END $f$;
REVOKE ALL ON FUNCTION public.cm_kpi_by_campaign_fast(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_kpi_by_campaign_fast(date, date) TO authenticated, service_role;

CREATE FUNCTION public.cm_kpi_by_campaign(_from date, _to date)
RETURNS TABLE(campaign_id uuid, campaign_name text, spend numeric, conversations bigint, converted bigint, orders bigint, delivered bigint, resolved bigint, delivered_value numeric, cost_per_delivered numeric) LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $f$
BEGIN
  IF auth.uid() IS NULL OR public.cm_can_read_all() THEN
    RETURN QUERY SELECT * FROM public.cm_kpi_by_campaign_fast(_from, _to);
  ELSE
    RETURN QUERY SELECT * FROM public.cm_kpi_by_campaign_core(_from, _to);
  END IF;
END $f$;
GRANT EXECUTE ON FUNCTION public.cm_kpi_by_campaign(date, date) TO authenticated, service_role;
