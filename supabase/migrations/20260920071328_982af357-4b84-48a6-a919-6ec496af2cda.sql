CREATE OR REPLACE FUNCTION public.order_matches_moderator(_user_id uuid, _moderator_text text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH v AS (
    SELECT
      public.normalize_ar(_moderator_text) AS m,
      public.normalize_ar((SELECT p.full_name FROM public.profiles p WHERE p.id = _user_id)) AS f
  )
  SELECT EXISTS (
    SELECT 1
    FROM v
    WHERE _moderator_text IS NOT NULL
      AND length(v.m) >= 3
      AND length(v.f) >= 3
      AND (
        v.m LIKE '%' || replace(replace(replace(v.f, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR v.f LIKE '%' || replace(replace(replace(v.m, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
  );
$function$;