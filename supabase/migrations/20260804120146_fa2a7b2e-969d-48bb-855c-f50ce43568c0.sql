CREATE OR REPLACE FUNCTION public.normalize_ar_name(txt text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, pg_temp
AS $function$
  SELECT lower(regexp_replace(
           translate(coalesce(txt,''),
             'إأآاىةٱ',
             'اااايه ا'
           ),
           '\s+', ' ', 'g'))
$function$;