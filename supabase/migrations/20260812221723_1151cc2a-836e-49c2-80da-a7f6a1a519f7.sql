CREATE OR REPLACE FUNCTION public.is_nora_reviewer(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_uid, 'sales_moderator'::app_role)
     AND EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = _uid
         AND public.normalize_ar_name(p.full_name) LIKE '%نور%'
     )
$function$;

CREATE OR REPLACE FUNCTION public.order_is_hagar(_moderator text, _created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    (public.normalize_ar_name(_moderator) LIKE '%هاجر%'
      OR public.normalize_ar_name(_moderator) LIKE '%منال%')
    OR (
      COALESCE(btrim(_moderator), '') = ''
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = _created_by
          AND (public.normalize_ar_name(p.full_name) LIKE '%هاجر%'
            OR public.normalize_ar_name(p.full_name) LIKE '%منال%')
      )
    )
$function$;

DROP POLICY IF EXISTS "Nora can review Hagar orders" ON public.orders;
CREATE POLICY "Nora can review Hagar orders"
ON public.orders
FOR SELECT
TO authenticated
USING (public.is_nora_reviewer(auth.uid()) AND public.order_is_hagar(moderator, created_by));