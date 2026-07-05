
-- Helper: normalize Arabic for name matching
CREATE OR REPLACE FUNCTION public.normalize_ar_name(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(
           translate(coalesce(txt,''),
             'إأآاىةٱ',
             'اااايه ا'
           ),
           '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.is_manal_reviewer(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_uid, 'sales_moderator'::app_role)
     AND EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = _uid
         AND public.normalize_ar_name(p.full_name) LIKE '%منال%'
     )
$$;

CREATE OR REPLACE FUNCTION public.order_is_nora_or_aya(_moderator text, _created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (public.normalize_ar_name(_moderator) LIKE '%نور%'
      OR public.normalize_ar_name(_moderator) LIKE '%ايه%'
      OR public.normalize_ar_name(_moderator) LIKE '%ايا%'
      OR public.normalize_ar_name(_moderator) ~ '(^|[^ي])اي([^ ]|$)')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = _created_by
        AND (public.normalize_ar_name(p.full_name) LIKE '%نور%'
          OR public.normalize_ar_name(p.full_name) LIKE '%ايه%'
          OR public.normalize_ar_name(p.full_name) LIKE '%ايا%'
          OR public.normalize_ar_name(p.full_name) ~ '(^|[^ي])اي([^ ]|$)')
    )
$$;

DROP POLICY IF EXISTS "Manal can review Nora and Aya orders" ON public.orders;
CREATE POLICY "Manal can review Nora and Aya orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  public.is_manal_reviewer(auth.uid())
  AND public.order_is_nora_or_aya(moderator, created_by)
);

DROP POLICY IF EXISTS "Manal can review Nora and Aya order items" ON public.order_items;
CREATE POLICY "Manal can review Nora and Aya order items"
ON public.order_items
FOR SELECT
TO authenticated
USING (
  public.is_manal_reviewer(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND public.order_is_nora_or_aya(o.moderator, o.created_by)
  )
);
