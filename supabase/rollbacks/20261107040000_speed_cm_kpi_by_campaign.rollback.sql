DROP FUNCTION public.cm_kpi_by_campaign(date, date);
DROP FUNCTION public.cm_kpi_by_campaign_fast(date, date);
ALTER FUNCTION public.cm_kpi_by_campaign_core(date, date) RENAME TO cm_kpi_by_campaign;
