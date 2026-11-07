-- Speed up chat KPIs by moderator (GM decision 7/11). Full readers (checked once)
-- compute as definer and skip per-row RLS; everyone else keeps the old behaviour.
ALTER FUNCTION public.cm_kpi_by_moderator(date, date) RENAME TO cm_kpi_by_moderator_core;

CREATE FUNCTION public.cm_kpi_by_moderator_fast(_from date, _to date)
RETURNS TABLE(moderator_id uuid, display_name text, conversations bigint, on_time bigint, cover bigint, late bigint, pending bigint, abandoned bigint, converted bigint, missed_calls bigint, missed_followed bigint, orders bigint, delivered bigint, resolved bigint, delivered_value numeric, campaign_delivered bigint, allocated_spend numeric, cost_per_delivered numeric, analyzed_calls bigint, avg_handling_score numeric, order_call_pct numeric, open_followups bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.cm_can_read_all() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.cm_kpi_by_moderator_core(_from, _to);
END $f$;
REVOKE ALL ON FUNCTION public.cm_kpi_by_moderator_fast(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_kpi_by_moderator_fast(date, date) TO authenticated, service_role;

CREATE FUNCTION public.cm_kpi_by_moderator(_from date, _to date)
RETURNS TABLE(moderator_id uuid, display_name text, conversations bigint, on_time bigint, cover bigint, late bigint, pending bigint, abandoned bigint, converted bigint, missed_calls bigint, missed_followed bigint, orders bigint, delivered bigint, resolved bigint, delivered_value numeric, campaign_delivered bigint, allocated_spend numeric, cost_per_delivered numeric, analyzed_calls bigint, avg_handling_score numeric, order_call_pct numeric, open_followups bigint) LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $f$
BEGIN
  IF auth.uid() IS NULL OR public.cm_can_read_all() THEN
    RETURN QUERY SELECT * FROM public.cm_kpi_by_moderator_fast(_from, _to);
  ELSE
    RETURN QUERY SELECT * FROM public.cm_kpi_by_moderator_core(_from, _to);
  END IF;
END $f$;
GRANT EXECUTE ON FUNCTION public.cm_kpi_by_moderator(date, date) TO authenticated, service_role;
