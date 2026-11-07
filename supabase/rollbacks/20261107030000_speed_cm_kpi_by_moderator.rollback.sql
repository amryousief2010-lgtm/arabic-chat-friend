DROP FUNCTION public.cm_kpi_by_moderator(date, date);
DROP FUNCTION public.cm_kpi_by_moderator_fast(date, date);
ALTER FUNCTION public.cm_kpi_by_moderator_core(date, date) RENAME TO cm_kpi_by_moderator;
