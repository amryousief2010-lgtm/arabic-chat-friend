CREATE OR REPLACE FUNCTION public.get_production_dashboard(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := current_date;
  v_month_start date := date_trunc('month', current_date)::date;
  v_year_start date := date_trunc('year', current_date)::date;
  v_from date := COALESCE(p_from, v_year_start);
  v_to date := COALESCE(p_to, v_today);
  v_eggs_today int; v_eggs_month int; v_eggs_year int; v_eggs_range int;
  v_chicks_today int; v_chicks_month int; v_chicks_year int; v_chicks_range int;
  v_sold_today int; v_sold_month int; v_sold_year int; v_sold_range int;
  v_rev_month numeric; v_rev_year numeric; v_rev_range numeric;
  v_daily jsonb;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN production_date = v_today THEN egg_count END),0),
    COALESCE(SUM(CASE WHEN production_date >= v_month_start THEN egg_count END),0),
    COALESCE(SUM(CASE WHEN production_date >= v_year_start THEN egg_count END),0),
    COALESCE(SUM(CASE WHEN production_date BETWEEN v_from AND v_to THEN egg_count END),0)
  INTO v_eggs_today, v_eggs_month, v_eggs_year, v_eggs_range
  FROM farm_egg_production WHERE production_date >= LEAST(v_year_start, v_from);

  SELECT
    COALESCE(SUM(CASE WHEN exit_date = v_today THEN hatched_chicks END),0),
    COALESCE(SUM(CASE WHEN exit_date >= v_month_start THEN hatched_chicks END),0),
    COALESCE(SUM(CASE WHEN exit_date >= v_year_start THEN hatched_chicks END),0),
    COALESCE(SUM(CASE WHEN exit_date BETWEEN v_from AND v_to THEN hatched_chicks END),0)
  INTO v_chicks_today, v_chicks_month, v_chicks_year, v_chicks_range
  FROM hatch_batches WHERE exit_date IS NOT NULL AND exit_date >= LEAST(v_year_start, v_from);

  SELECT
    COALESCE(SUM(CASE WHEN movement_date = v_today THEN sold END),0),
    COALESCE(SUM(CASE WHEN movement_date >= v_month_start THEN sold END),0),
    COALESCE(SUM(CASE WHEN movement_date >= v_year_start THEN sold END),0),
    COALESCE(SUM(CASE WHEN movement_date BETWEEN v_from AND v_to THEN sold END),0),
    COALESCE(SUM(CASE WHEN movement_date >= v_month_start THEN sold * unit_price END),0),
    COALESCE(SUM(CASE WHEN movement_date >= v_year_start THEN sold * unit_price END),0),
    COALESCE(SUM(CASE WHEN movement_date BETWEEN v_from AND v_to THEN sold * unit_price END),0)
  INTO v_sold_today, v_sold_month, v_sold_year, v_sold_range, v_rev_month, v_rev_year, v_rev_range
  FROM chick_movements WHERE movement_date >= LEAST(v_year_start, v_from);

  WITH days AS (
    SELECT generate_series(v_month_start, v_today, '1 day'::interval)::date AS d
  ),
  c AS (
    SELECT exit_date AS d, SUM(hatched_chicks)::int AS chicks
    FROM hatch_batches WHERE exit_date BETWEEN v_month_start AND v_today GROUP BY exit_date
  ),
  s AS (
    SELECT movement_date AS d, SUM(sold)::int AS sold, SUM(sold * unit_price)::numeric AS revenue
    FROM chick_movements WHERE movement_date BETWEEN v_month_start AND v_today GROUP BY movement_date
  ),
  e AS (
    SELECT production_date AS d, SUM(egg_count)::int AS eggs
    FROM farm_egg_production WHERE production_date BETWEEN v_month_start AND v_today GROUP BY production_date
  )
  SELECT jsonb_agg(jsonb_build_object(
    'date', to_char(days.d, 'YYYY-MM-DD'),
    'eggs', COALESCE(e.eggs,0),
    'chicks', COALESCE(c.chicks,0),
    'sold', COALESCE(s.sold,0),
    'revenue', COALESCE(s.revenue,0)
  ) ORDER BY days.d)
  INTO v_daily
  FROM days LEFT JOIN c ON c.d = days.d LEFT JOIN s ON s.d = days.d LEFT JOIN e ON e.d = days.d;

  RETURN jsonb_build_object(
    'eggs', jsonb_build_object('today', v_eggs_today, 'month', v_eggs_month, 'year', v_eggs_year, 'range', v_eggs_range),
    'chicks', jsonb_build_object('today', v_chicks_today, 'month', v_chicks_month, 'year', v_chicks_year, 'range', v_chicks_range),
    'sales', jsonb_build_object('sold_today', v_sold_today, 'sold_month', v_sold_month, 'sold_year', v_sold_year, 'sold_range', v_sold_range,
                                'revenue_month', v_rev_month, 'revenue_year', v_rev_year, 'revenue_range', v_rev_range),
    'daily', COALESCE(v_daily, '[]'::jsonb),
    'range', jsonb_build_object('from', to_char(v_from,'YYYY-MM-DD'), 'to', to_char(v_to,'YYYY-MM-DD'))
  );
END;
$$;